#!/usr/bin/env node

'use strict';

import fs from 'fs';
import path from 'path';
import clipboardy from 'clipboardy';
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import chalk from 'chalk';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import puppeteer from 'puppeteer';
import readline from 'readline';
import crypto from 'crypto';
import { globSync } from 'glob';   
import ignore from 'ignore';

const defaultBinaryExtensions = ['.png','.jpg','.jpeg','.gif','.pdf','.zip','.rar','.7z','.exe','.dll','.bin','.mp4','.mp3','.wav','.mov','.avi'];
const defaultIgnores = [
  'node_modules/**',
  'package-lock.json',
  '.*',
  '**/.*',
  ...defaultBinaryExtensions.map(ext => `*${ext}`)
];

// Define command line options
const optionDefinitions = [
  { name: 'copy', alias: 'c', type: Boolean, description: 'Copy output to clipboard' },
  { name: 'tiny', alias: 't', type: Boolean, description: 'Removes double whitespaces from output' },
  { name: 'file', multiple: true, defaultOption: true, type: String, description: 'Files/URLs to read. Supports wildcards.' },
  { name: 'prefix', alias: 'p', type: String, description: 'Prefix for the output. String or file path.' },
  { name: 'output', alias: 'o', type: String, description: 'Write output to a file' },
  { name: 'help', alias: 'h', type: Boolean, description: 'Print usage help' },
  { name: 'silent', alias: 's', type: Boolean, description: 'Silent output (no console prints)' },
  { name: 'debug', alias: 'd', type: Boolean, description: 'Debug mode' },
  { name: 'version', alias: 'V', type: Boolean, description: 'Print the version number and exit' },
  { name: 'license', alias: 'l', type: Boolean, description: 'Print license and exit' },
  { name: 'noColor', alias: 'n', type: Boolean, description: 'Disable colored output' },
  { name: 'backup', alias: 'b', type: Boolean, description: 'Create/update a backup of current arguments in thisismy.json' },
  { name: 'watch', alias: 'w', type: Boolean, description: 'Watch for changes and ask to re-run on changes' },
  { name: 'interval', alias: 'i', type: Number, description: 'Interval in minutes for re-checking URLs (default: 5)' },
  { name: 'greedy', alias: 'g', type: Boolean, description: 'Ignore all ignore rules and include all matched files' },
  { name: 'recursive', alias: 'r', type: Boolean, description: 'Recurse into subdirectories when searching for files (for patterns)' }
];

// Fetch options for URLs
const fetchOptions = {
  headers: {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  }
};

// ---------------------------------------------
// Run the main logic
// ---------------------------------------------
async function run() {
  let options = commandLineArgs(optionDefinitions);
  handleBackup(options);
  options = loadDefaults(options);

  if (options.version) { printVersion(); return; }
  if (options.license) { printLicense(); return; }
  if (options.help) { printUsage(); return; }

  if (!options.file || options.file.length === 0) {
    console.error('Error: No file specified');
    printUsage();
    return;
  }

  if (!options.interval || options.interval < 1) {
    options.interval = 5;
  }

  if (options.debug && !options.silent) {
    console.log('Options:', options);
  }

  // If recursive, list all subdirectories from current folder first
  if (options.recursive && !options.silent) {
    console.log('Listing all subdirectories from the current folder:');
    const allSubDirs = globSync('**/', { dot: true })
      .filter(dir => dir !== '.');
    
    // Create ignore instance for directory filtering
    const dirIg = ignore();
    if (fs.existsSync('.thisismyignore')) {
      dirIg.add(fs.readFileSync('.thisismyignore', 'utf8'));
    } else if (fs.existsSync('.gitignore')) {
      dirIg.add(fs.readFileSync('.gitignore', 'utf8'));
    }
    if (!options.greedy) {
      dirIg.add(defaultIgnores);
    }

    // Filter directories
    const filteredDirs = allSubDirs.filter(dir => {
      if (options.greedy) return true;
      const relativeDir = path.relative(process.cwd(), dir);
      if (!relativeDir) return true; // Skip empty paths
      return !dirIg.ignores(relativeDir);
    });

    filteredDirs.forEach(d => console.log('  ' + d));
    console.log('--- End of subdirectory listing ---');
  }

  // If prefix provided, load its contents
  let prefixContent = '';
  if (options.prefix) {
    if (fs.existsSync(options.prefix)) {
      prefixContent = fs.readFileSync(options.prefix, 'utf8');
    } else {
      prefixContent = options.prefix;
    }
  }

  // Resolve resources, applying ignore and recursion rules
  const { finalResources, isSingleExactFile, directoriesScanned } = await resolveResources(options);

  // If no resources found at all, notify and exit gracefully
  if (finalResources.length === 0) {
    if (!options.silent) console.log('No files/URLs found after applying rules.');
    return;
  }

  // Print info about recursion if enabled
  if (options.recursive && !options.silent) {
    console.log('Recursive search enabled. Directories scanned:');
    directoriesScanned.forEach(dir => console.log(`  ${dir}`));
    console.log(`Found ${finalResources.length} file(s)/URL(s) in total.`);
  }

  // Process the selected files/URLs
  await processFilesAndUrls(options, prefixContent, finalResources);

  // If watch mode is enabled, start watching and then enter watch mode loop
  if (options.watch) {
    await startWatching(options, prefixContent, finalResources);

    // Inform user about watch mode and how to exit
    if (!options.silent) {
      console.log('Watch mode enabled. Press "x" then ENTER at any time to exit watch mode.');
    }

    // Listen for 'x' input to exit watch mode
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('line', (line) => {
      if (line.trim().toLowerCase() === 'x') {
        if (!options.silent) {
          console.log('Exiting watch mode...');
        }
        process.exit(0);
      }
    });
  }
}

// ---------------------------------------------
// Handle backup option: writes current args to thisismy.json
// ---------------------------------------------
function handleBackup(options) {
  if (options.backup) {
    const backupOptions = { ...options };
    delete backupOptions.backup;
    fs.writeFileSync('thisismy.json', JSON.stringify(backupOptions));
  }
}

// ---------------------------------------------
// Load defaults from thisismy.json if present
// ---------------------------------------------
function loadDefaults(options) {
  let defaultOptions = {};
  if (fs.existsSync('thisismy.json')) {
    defaultOptions = JSON.parse(fs.readFileSync('thisismy.json', 'utf8'));
  }
  return { ...defaultOptions, ...options };
}

// ---------------------------------------------
// Print version info
// ---------------------------------------------
function printVersion() {
  const packageInfo = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  console.log(`thisismy ${packageInfo.version}`);
}

// ---------------------------------------------
// Print license info
// ---------------------------------------------
function printLicense() {
  console.log('MIT License');
}

// ---------------------------------------------
// Print usage help
// ---------------------------------------------
function printUsage() {
  const usage = commandLineUsage([
    { header: 'thisismy', content: 'Prints and processes contents of files/URLs with optional prefix, ignoring rules, and more.' },
    { header: 'Options', optionList: optionDefinitions },
    {
      header: 'Behavior',
      content: [
        '- By default, respects ignore rules from `.thisismyignore` if present, otherwise from `.gitignore` if present.',
        '- If no ignore file is found, defaults to ignoring dotfiles and typical binary files when multiple files/patterns are given.',
        '- A single explicitly named file bypasses ignore rules unless `-g` is used.',
        '- `-g` (greedy) includes all files, ignoring any ignore rules.',
        '- `-r` (recursive) searches subdirectories and reports what was scanned.',
        '- `-w` (watch) re-prompts when changes in watched files/URLs occur.'
      ]
    },
    {
      header: 'Examples',
      content: [
        { desc: 'Print a single file', example: 'thisismy file.txt' },
        { desc: 'Copy output', example: 'thisismy -c file.txt' },
        { desc: 'Write output to a file', example: 'thisismy -o out.txt file.txt' },
        { desc: 'Use prefix', example: 'thisismy -p prefix.txt file.txt' },
        { desc: 'Watch mode', example: 'thisismy -w *.js' },
        { desc: 'Greedy (no ignoring)', example: 'thisismy -g *.png' },
        { desc: 'Recursive search', example: 'thisismy -r *.js' }
      ]
    }
  ]);
  console.log(usage);
}

// ---------------------------------------------
// Fetch URL content with fallback to headless browser if needed
// ---------------------------------------------
async function fetchURL(url, tryJS = false) {
  if (!tryJS) {
    try {
      const response = await fetch(url, fetchOptions);
      const html = await response.text();
      const content = parseContent(html);
      if (!content) return fetchURL(url, true);
      return content;
    } catch (err) {
      console.error(err);
      return '';
    }
  } else {
    let browser;
    try {
      browser = await puppeteer.launch();
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2' });
      const html = await page.content();
      const content = parseContent(html);
      if (!content) return html;
      return content;
    } catch (err) {
      console.error(err);
      return '';
    } finally {
      if (browser) await browser.close();
    }
  }
}

// ---------------------------------------------
// Parse HTML content from a webpage using Readability
// ---------------------------------------------
function parseContent(html) {
  const doc = new JSDOM(html);
  const reader = new Readability(doc.window.document);
  const article = reader.parse();
  if (!article) return null;
  let content = article.textContent;
  if (!content) content = article.content;
  if (!content) content = html;
  return content;
}

// ---------------------------------------------
// Process a list of files/URLs: read content, prefix, colorize, etc.
// ---------------------------------------------
async function processFilesAndUrls(options, prefixContent, resources) {
  const outputArr = [];
  for (const filename of resources) {
    const content = await printFileContents(filename, options, prefixContent);
    outputArr.push(content);
  }

  const finalOutput = outputArr.join('');

  if (!options.silent) {
    console.log(finalOutput);
  }

  if (options.output) {
    fs.writeFileSync(options.output, finalOutput);
    if (!options.silent) {
      logColored(`Output written to ${options.output}`, chalk.yellow, options);
    }
  }

  if (options.copy) {
    clipboardy.writeSync(finalOutput);
    if (!options.silent) {
      logColored('Output copied to clipboard', chalk.yellow, options);
    }
  }
}

// ---------------------------------------------
// Print the contents of a single file/URL with headers/footers/prefix
// ---------------------------------------------
async function printFileContents(filename, options, prefixContent) {
  let contents = '';
  const now = new Date();
  const dateStr = formatDate(now);
  let header = `\n\nThis is my current ${filename} at ${dateStr}\n\n`;
  let footer = `\n\nThis is the end of ${filename}\n\n`;

  if (filename.startsWith('http')) {
    contents = await fetchURL(filename);
    header = `\n\nThis is the current ${filename} at ${dateStr}\n\n`;
    footer = `\n\nThis is the end of ${filename}\n\n`;
  } else {
    contents = fs.readFileSync(filename, 'utf8');
  }

  if (options.tiny) {
    contents = contents.replace(/[\s\n]+/g, ' ').trim();
  }

  const coloredHeader = colorize(header, chalk.blue, options);
  const coloredFooter = colorize(footer, chalk.blue, options);
  const coloredContents = colorize(contents, chalk.green, options);

  const finalData = prefixContent + coloredHeader + coloredContents + coloredFooter;
  return finalData;
}

// ---------------------------------------------
// Colorize output if allowed
// ---------------------------------------------
function colorize(str, colorFunc, options) {
  if (options.silent || options.copy || options.output || options.watch) {
    return options.noColor ? str : str;
  }
  if (options.noColor) return str;
  return colorFunc(str); 
}

// ---------------------------------------------
// Log with colors if allowed
// ---------------------------------------------
function logColored(msg, colorFunc, options) {
  if (options.noColor) {
    console.log(msg);
  } else {
    console.log(colorFunc(msg));
  }
}

// ---------------------------------------------
// Format date into dd.mm.yyyy hh:mm:ss
// ---------------------------------------------
function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}:${ss}`;
}

// ---------------------------------------------
// Start watching resources. Local files with fs.watch, URLs with setInterval
// ---------------------------------------------
async function startWatching(options, prefixContent, resources) {
  const interval = options.interval * 60 * 1000;
  let prevContentMap = new Map();

  for (const res of resources) {
    const content = await getContent(res, options);
    prevContentMap.set(res, hashContent(content));

    if (!res.startsWith('http')) {
      fs.watch(res, { persistent: true }, async () => {
        await handleChange(res, prevContentMap, options, prefixContent, resources);
      });
    }
  }

  if (resources.some(r => r.startsWith('http'))) {
    setInterval(async () => {
      for (const r of resources.filter(r => r.startsWith('http'))) {
        await handleChange(r, prevContentMap, options, prefixContent, resources);
      }
    }, interval);
  }
}

// ---------------------------------------------
// Handle a change in a watched file/URL: ask user if they want to re-run
// ---------------------------------------------
async function handleChange(resource, prevContentMap, options, prefixContent, allResources) {
  const newContent = await getContent(resource, options);
  const newHash = hashContent(newContent);
  const oldHash = prevContentMap.get(resource);

  if (newHash !== oldHash) {
    prevContentMap.set(resource, newHash);
    await askForReRun([resource], options, prefixContent, allResources);
  }
}

// ---------------------------------------------
// Prompt user if they want to re-run after changes
// ---------------------------------------------
async function askForReRun(changedResources, options, prefixContent, allResources) {
  if (changedResources.length === 0) return;
  if (!options.silent) {
    console.log('\nThese resources were changed:');
    for (const res of changedResources) {
      console.log(res);
    }
    console.log('Do you want to copy + trim it again? [y/n/x]');
  }

  const answer = await promptUser();
  if (answer.toLowerCase() === 'y') {
    await processFilesAndUrls(options, prefixContent, allResources);
  } else if (answer.toLowerCase() === 'x') {
    // Exit the process
    process.exit(0);
  }
}

// ---------------------------------------------
// Prompt user from stdin
// ---------------------------------------------
function promptUser() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('', (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

// ---------------------------------------------
// Get content from either file or URL
// ---------------------------------------------
async function getContent(resource, options) {
  if (resource.startsWith('http')) {
    return await fetchURL(resource);
  } else {
    return fs.readFileSync(resource, 'utf8');
  }
}

// ---------------------------------------------
// Hash content to detect changes
// ---------------------------------------------
function hashContent(str) {
  return crypto.createHash('sha256').update(str || '').digest('hex');
}

// ---------------------------------------------
// Resolve resources to process:
// - Handle single exact file case
// - Handle multiple patterns and apply ignore rules
// - Handle recursion (-r) by modifying patterns
// - Return directories scanned info if recursive
// ---------------------------------------------
async function resolveResources(options) {
  const inputPaths = options.file;
  const hasWildcard = inputPaths.some(p => p.includes('*'));
  const multipleFiles = inputPaths.length > 1;
  const isSingleExactFile = !multipleFiles && !hasWildcard && inputPaths.length === 1 && !inputPaths[0].startsWith('http');
  
  // If single exact file and not URL, just return it as is (unless it's missing)
  if (isSingleExactFile && !options.greedy) {
    const singleFile = inputPaths[0];
    if (fs.existsSync(singleFile) || singleFile.startsWith('http')) {
      return { finalResources: [singleFile], isSingleExactFile: true, directoriesScanned: [] };
    } else {
      return { finalResources: [], isSingleExactFile: true, directoriesScanned: [] };
    }
  }

  let finalResources = [];
  
  // Collect all ignore patterns
  const ignorePatterns = [];

  // Add default ignores if not in greedy mode
  if (!options.greedy) {
    ignorePatterns.push(...defaultIgnores);
  }

  // Add ignores from .thisismyignore or .gitignore if present
  if (fs.existsSync('.thisismyignore')) {
    ignorePatterns.push(...fs.readFileSync('.thisismyignore', 'utf8').split('\n'));
  } else if (fs.existsSync('.gitignore')) {
    ignorePatterns.push(...fs.readFileSync('.gitignore', 'utf8').split('\n'));
  }

  for (const pth of inputPaths) {
    if (pth.startsWith('http')) {
      // URLs are always included as is
      finalResources.push(pth);
      continue;
    }

    let pattern = pth;
    // If recursive (-r) and no '**' present, add it
    if (options.recursive && !pattern.includes('**')) {
      if (pattern.startsWith('./')) {
        pattern = './**/' + pattern.slice(2);
      } else if (!pattern.startsWith('**/')) {
        pattern = '**/' + pattern;
      }
    }

    // Use globSync with ignore patterns
    const globOptions = {
      dot: options.greedy,
      ignore: ignorePatterns
    };

    const matches = globSync(pattern, globOptions);
    finalResources.push(...matches);
  }

  // Remove duplicates and ensure paths are relative
  finalResources = Array.from(new Set(finalResources)).map(f => path.relative(process.cwd(), f));

  // Filter out directories
  finalResources = finalResources.filter(f => {
    try {
      const stat = fs.lstatSync(f);
      return stat.isFile();
    } catch {
      return false;
    }
  });

  // Collect directories from finalResources after filtering
  const directoriesScanned = new Set(finalResources.map(f => path.dirname(f)));

  // If -r is used, print which directories will be searched
  if (options.recursive && !options.silent) {
    console.log('Recursive search enabled. Potential directories to search from current pattern:');
    for (const dir of directoriesScanned) {
      console.log('  ' + dir);
    }
    console.log(`Found ${finalResources.length} file(s) after applying ignore rules and final filtering.`);
  }

  return { finalResources, isSingleExactFile: false, directoriesScanned: Array.from(directoriesScanned) };
}

// ---------------------------------------------
// Run the program
// ---------------------------------------------
await run();