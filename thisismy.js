#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * -----------------------------------------------------------------------------
 * thisismy - A CLI tool to concatenate file/URL content, apply prefixes,
 * respect ignore rules, watch for changes, optionally trim whitespace,
 * copy to clipboard, show a directory tree, etc.
 *
 * Updates requested:
 *  1. Show defaults from thisismy.json in the console (in color) if present.
 *  2. Add more typical binary file extensions to default ignores:
 *     e.g., .ico, .ttf, .woff, .woff2, .otf, .bak, .xz, .tgz, .gz, .dmg, .iso,
 *     .tar, .doc, .docx, .ppt, .pptx, .apk, .ipa, .img, etc.
 *  3. If -y is used, the tree view should also be appended to the final output
 *     that is copied (if -c) or written to file (if -o).
 *  4. No breaking changes.
 * -----------------------------------------------------------------------------
 */

import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
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

//
// Extended default ignoring patterns
// (original plus additional typical binary/fonts/icons, etc.)
//
const extendedBinaryExtensions = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.pdf',
  '.zip',
  '.rar',
  '.7z',
  '.exe',
  '.dll',
  '.bin',
  '.mp4',
  '.mp3',
  '.wav',
  '.mov',
  '.avi',
  '.ico',
  '.ttf',
  '.woff',
  '.woff2',
  '.otf',
  '.bak',
  '.xz',
  '.tgz',
  '.gz',
  '.dmg',
  '.iso',
  '.tar',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.apk',
  '.ipa',
  '.img',
];

const defaultIgnores = [
  'node_modules/**',
  'package-lock.json',
  '.*',
  '**/.*',
  ...extendedBinaryExtensions.map((ext) => `*${ext}`),
];

//
// CLI option definitions
//
const optionDefinitions = [
  { name: 'copy', alias: 'c', type: Boolean, description: 'Copy output to clipboard' },
  {
    name: 'tiny',
    alias: 't',
    type: Boolean,
    description: 'Trim extra spaces (collapse multiple spaces, remove leading/trailing)',
  },
  {
    name: 'file',
    multiple: true,
    defaultOption: true,
    type: String,
    description: 'Files/URLs to read. Supports wildcards.',
  },
  {
    name: 'prefix',
    alias: 'p',
    type: String,
    description: 'Prefix for the output. String or file path.',
  },
  { name: 'output', alias: 'o', type: String, description: 'Write output to a file' },
  { name: 'help', alias: 'h', type: Boolean, description: 'Print usage help' },
  { name: 'silent', alias: 's', type: Boolean, description: 'Silent output (no console prints)' },
  { name: 'debug', alias: 'd', type: Boolean, description: 'Debug mode' },
  { name: 'version', alias: 'V', type: Boolean, description: 'Print the version number and exit' },
  { name: 'license', alias: 'l', type: Boolean, description: 'Print license and exit' },
  { name: 'noColor', alias: 'n', type: Boolean, description: 'Disable colored output' },
  {
    name: 'backup',
    alias: 'b',
    type: Boolean,
    description: 'Create/update a backup of current arguments in thisismy.json',
  },
  { name: 'watch', alias: 'w', type: Boolean, description: 'Watch for changes' },
  {
    name: 'interval',
    alias: 'i',
    type: Number,
    description: 'Interval in minutes for re-checking URLs (default: 5)',
  },
  {
    name: 'greedy',
    alias: 'g',
    type: Boolean,
    description: 'Ignore all ignore rules and include all matched files',
  },
  {
    name: 'recursive',
    alias: 'r',
    type: Boolean,
    description: 'Recurse into subdirectories when searching for files (wildcards)',
  },
  {
    name: 'tree',
    alias: 'y',
    type: Boolean,
    description: 'At the end of output, show a tree view of processed files',
  },
];

const fetchOptions = {
  headers: {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  },
};

/**
 * Main program entry point
 */
async function main() {
  let options = commandLineArgs(optionDefinitions);
  handleBackup(options);

  // Set default behavior when no arguments provided
  if (Object.keys(options).length === 0 || 
      (Object.keys(options).length === 1 && options.file === undefined)) {
    options = {
      copy: true,
      recursive: true,
      tree: true,
      file: ["*"]
    };
  }

  // Attempt to load defaults
  const { finalOptions, loadedDefaults } = loadDefaults(options);

  // Show loaded defaults in color, if any
  if (!finalOptions.silent && Object.keys(loadedDefaults).length > 0) {
    displayDefaultsUsed(loadedDefaults, finalOptions);
  }

  options = finalOptions;

  if (options.version) {
    printVersion();
    return;
  }
  if (options.license) {
    printLicense();
    return;
  }
  if (options.help) {
    printUsage();
    return;
  }

  // If recursive is set but no files specified, use "*" as default
  if (options.recursive && (!options.file || options.file.length === 0)) {
    options.file = ["*"];
  } else if (!options.file || options.file.length === 0) {
    console.error('Error: No file specified');
    printUsage();
    return;
  }

  // Default interval
  if (!options.interval || options.interval < 1) {
    options.interval = 5;
  }

  if (options.debug && !options.silent) {
    console.log('Options:', options);
  }

  // If recursive, optionally list subdirectories
  if (options.recursive && !options.silent) {
    console.log('Listing all subdirectories from the current folder:');
    const allSubDirs = globSync('**/', { dot: true }).filter((dir) => dir !== '.');

    const dirIg = ignore();
    if (fs.existsSync('.thisismyignore')) {
      dirIg.add(fs.readFileSync('.thisismyignore', 'utf8'));
    } else if (fs.existsSync('.gitignore')) {
      dirIg.add(fs.readFileSync('.gitignore', 'utf8'));
    }
    if (!options.greedy) {
      dirIg.add(defaultIgnores);
    }

    const filteredDirs = allSubDirs.filter((dir) => {
      if (options.greedy) return true;
      const relativeDir = path.relative(process.cwd(), dir);
      if (!relativeDir) return true;
      return !dirIg.ignores(relativeDir);
    });

    filteredDirs.forEach((d) => console.log(`  ${d}`));
    console.log('--- End of subdirectory listing ---');
  }

  // Load prefix content
  const prefixContent = loadPrefixContent(options.prefix);

  // Resolve final resource list
  const { finalResources, directoriesScanned } = await resolveResources(options);
  if (finalResources.length === 0) {
    if (!options.silent) {
      console.log('No files/URLs found after applying rules.');
    }
    return;
  }

  if (options.recursive && !options.silent) {
    console.log('Recursive search enabled. Directories scanned:');
    directoriesScanned.forEach((dir) => console.log(`  ${dir}`));
    console.log(`Found ${finalResources.length} file(s)/URL(s) in total.`);
  }

  // Process all resources into a single output
  let finalOutput = await processFilesAndUrls(options, prefixContent, finalResources);

  // If user requested a tree view, generate that and append it to the final output
  if (options.tree) {
    const treeResult = buildTreeOutput(finalResources, options);
    // Append to final output so that -c or -o also includes the tree
    finalOutput += treeResult.rawTree;
    if (!options.silent) {
      // Print the colored version
      console.log(treeResult.coloredTree);
    }
  }

  // If the user specified output to file
  if (options.output) {
    fs.writeFileSync(options.output, finalOutput);
    if (!options.silent) {
      logColored(`Output written to ${options.output}`, chalk.yellow, options);
    }
  }

  // If the user specified copy to clipboard, copy final output (including tree)
  if (options.copy) {
    clipboardy.writeSync(finalOutput);
    if (!options.silent) {
      logColored('Output copied to clipboard', chalk.yellow, options);
    }
  }

  // If watch mode is enabled, start watchers
  if (options.watch) {
    await startWatching(options, prefixContent, finalResources);

    if (!options.silent) {
      console.log('Watch mode enabled. Press "x" then ENTER at any time to exit watch mode.');
    }

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

  // Return final output if needed
  return finalOutput;
}

/**
 * Backs up current options into thisismy.json if requested.
 */
function handleBackup(options) {
  if (options.backup) {
    const backupOptions = { ...options };
    delete backupOptions.backup;
    fs.writeFileSync('thisismy.json', JSON.stringify(backupOptions, null, 2));
  }
}

/**
 * Attempt to load defaults from thisismy.json. Returns both the final merged
 * options and the loaded defaults, so we can display them in the console.
 */
function loadDefaults(options) {
  let loadedDefaults = {};
  if (fs.existsSync('thisismy.json')) {
    try {
      loadedDefaults = JSON.parse(fs.readFileSync('thisismy.json', 'utf8')) || {};
    } catch {
      loadedDefaults = {};
    }
  }
  const finalOptions = { ...loadedDefaults, ...options };
  return { finalOptions, loadedDefaults };
}

/**
 * Display loaded defaults from thisismy.json if they exist
 */
function displayDefaultsUsed(loadedDefaults, options) {
  const defaultsStr = JSON.stringify(loadedDefaults, null, 2);
  const msg = `Using defaults from thisismy.json:\n${defaultsStr}`;
  logColored(msg, chalk.cyanBright, options);
}

/**
 * Print version from package.json
 */
function printVersion() {
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  console.log(`thisismy ${pkg.version}`);
}

/**
 * Print a short license snippet
 */
function printLicense() {
  console.log('MIT License');
}

/**
 * Print usage instructions
 */
function printUsage() {
  const usage = commandLineUsage([
    {
      header: 'thisismy',
      content:
        'Aggregates file or URL content, optionally ignoring files, trimming whitespace, ' +
        'and more.',
    },
    {
      header: 'Options',
      optionList: optionDefinitions,
    },
    {
      header: 'Behavior',
      content: [
        '- Respects `.thisismyignore` or `.gitignore` unless `-g` is used.',
        '- If no ignore file, defaults to ignoring dotfiles & common binaries unless `-g`.',
        '- `-t` (tiny) collapses whitespace. By default, no whitespace trimming.',
        '- `-w` (watch) re-prompts on changes. `-r` (recursive) globs subdirectories.',
        '- `-y` (tree) prints a tree-like view of processed files at the end.',
        '- The final output can be copied (`-c`) or written to a file (`-o`).',
      ],
    },
    {
      header: 'Examples',
      content: [
        { desc: 'Read a single file', example: 'thisismy file.txt' },
        { desc: 'Copy to clipboard', example: 'thisismy -c file.txt' },
        { desc: 'Write to file', example: 'thisismy -o out.txt file.txt' },
        { desc: 'Trim whitespace', example: 'thisismy -t file.txt' },
        { desc: 'Recursive watch', example: 'thisismy -rw "**/*.js"' },
        { desc: 'Greedy (ignore ignoring)', example: 'thisismy -g *.png' },
        { desc: 'Print a tree view', example: 'thisismy -y ./*.js' },
      ],
    },
  ]);
  console.log(usage);
}

/**
 * Load prefix from file or literal string
 */
function loadPrefixContent(prefix) {
  if (!prefix) return '';
  if (fs.existsSync(prefix)) {
    return fs.readFileSync(prefix, 'utf8');
  }
  return prefix;
}

/**
 * Resolve resources (files/URLs) from user input, apply ignoring unless greedy.
 */
async function resolveResources(options) {
  const inputPaths = options.file;
  const ignoreManager = ignore();
  let finalResources = [];

  // If not greedy, load defaultIgnores + .thisismyignore or .gitignore
  if (!options.greedy) {
    ignoreManager.add(defaultIgnores);
    if (fs.existsSync('.thisismyignore')) {
      ignoreManager.add(fs.readFileSync('.thisismyignore', 'utf8'));
    } else if (fs.existsSync('.gitignore')) {
      ignoreManager.add(fs.readFileSync('.gitignore', 'utf8'));
    }
  }

  const allMatchedFiles = [];
  const allIgnoredFiles = [];

  for (let pattern of inputPaths) {
    if (pattern.startsWith('http')) {
      // Always include URLs
      finalResources.push(pattern);
      continue;
    }

    // If recursive and no '**', inject
    if (options.recursive && !pattern.includes('**')) {
      if (pattern.startsWith('./')) {
        pattern = `./**/${pattern.slice(2)}`;
      } else if (!pattern.startsWith('**/')) {
        pattern = `**/${pattern}`;
      }
    }

    const matched = globSync(pattern, { dot: true });
    allMatchedFiles.push(...matched);
  }

  // Filter duplicates
  const uniqueMatched = [...new Set(allMatchedFiles)];

  // Filter out directories
  const validFiles = uniqueMatched.filter((f) => {
    try {
      return fs.lstatSync(f).isFile();
    } catch {
      return false;
    }
  });

  // If not greedy, check ignore
  if (!options.greedy) {
    for (const filePath of validFiles) {
      const relative = path.relative(process.cwd(), filePath);
      if (ignoreManager.ignores(relative)) {
        allIgnoredFiles.push(relative);
      } else {
        finalResources.push(relative);
      }
    }
  } else {
    finalResources.push(...validFiles.map((f) => path.relative(process.cwd(), f)));
  }

  // Print which were ignored
  if (!options.greedy && !options.silent && allIgnoredFiles.length > 0) {
    console.log(chalk.magenta('Ignored files:'));
    for (const ignored of allIgnoredFiles) {
      console.log(`  ${chalk.magenta(ignored)}`);
    }
  }

  // Identify directories scanned
  const directoriesScanned = new Set(
    finalResources.filter((f) => !f.startsWith('http')).map((f) => path.dirname(f)),
  );

  return {
    finalResources,
    directoriesScanned: Array.from(directoriesScanned),
  };
}

/**
 * Orchestrate reading all resources, building a final output string, but does NOT
 * print the tree here (that is handled separately). Returns a single combined string.
 */
async function processFilesAndUrls(options, prefixContent, resources) {
  const outputsRaw = [];

  for (const resource of resources) {
    const rawContent = await getRawResourceContent(resource);
    const { raw: rawFinal, colored: coloredFinal } = transformContent(
      rawContent,
      resource,
      prefixContent,
      options,
    );
    outputsRaw.push(rawFinal);

    // Print colored to console (only if not silent)
    if (!options.silent) {
      console.log(coloredFinal);
    }
  }

  // Combine final raw
  return outputsRaw.join('');
}

/**
 * Return raw content from either a URL or file (no transformations).
 */
async function getRawResourceContent(resource) {
  if (resource.startsWith('http')) {
    return await fetchURL(resource);
  }
  // local file
  try {
    return fs.readFileSync(resource, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Convert raw resource content to a final form:
 *  - Add prefix
 *  - Add header/footer
 *  - Optionally trim whitespace if -t
 *  - Return both raw (no color) and colored versions
 */
function transformContent(raw, resourceName, prefixContent, options) {
  // Prepare standard header/footer
  const now = new Date();
  const dateStr = formatDate(now);

  // Slightly different for URLs vs files
  const isURL = resourceName.startsWith('http');
  const header = `\n\nThis is the ${isURL ? 'current' : 'my current'} ${resourceName} at ${dateStr}\n\n`;
  const footer = `\n\nThis is the end of ${resourceName}\n\n`;

  // If -t, we do whitespace collapse
  let content = raw;
  if (options.tiny) {
    content = content.replace(/\s+/g, ' ').trim();
  }

  // Build raw version
  const rawVersion = `${prefixContent}${header}${content}${footer}`;

  // Build colored version
  const coloredPrefix = colorize(prefixContent, chalk.green, options);
  const coloredHeader = colorize(header, chalk.blue, options);
  const coloredContent = colorize(content, chalk.green, options);
  const coloredFooter = colorize(footer, chalk.blue, options);

  return {
    raw: rawVersion,
    colored: coloredPrefix + coloredHeader + coloredContent + coloredFooter,
  };
}

/**
 * Colorize a string for console, if allowed (no silent, noColor).
 */
function colorize(str, colorFunc, options) {
  if (options.silent) return str;
  if (options.noColor) return str;
  return colorFunc(str);
}

/**
 * Log a message with optional color
 */
function logColored(message, colorFunc, options) {
  if (options.silent) return;
  if (options.noColor) {
    console.log(message);
  } else {
    console.log(colorFunc(message));
  }
}

/**
 * Format date as dd.mm.yyyy hh:mm:ss
 */
function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}:${ss}`;
}

/**
 * Fetch URL content, using plain fetch first, then fallback to Puppeteer if needed.
 */
async function fetchURL(url, tryJS = false) {
  if (!tryJS) {
    try {
      const response = await fetch(url, fetchOptions);
      const html = await response.text();
      const content = parseHTMLWithReadability(html);
      if (!content) {
        // fallback
        return fetchURL(url, true);
      }
      return content;
    } catch (err) {
      console.error(err);
      return '';
    }
  }
  // fallback to puppeteer
  let browser;
  try {
    browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    const html = await page.content();
    const content = parseHTMLWithReadability(html);
    return content || html;
  } catch (err) {
    console.error(err);
    return '';
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Parse HTML using JSDOM + Readability
 */
function parseHTMLWithReadability(html) {
  const doc = new JSDOM(html);
  const reader = new Readability(doc.window.document);
  const article = reader.parse();
  if (!article) return null;

  let { textContent } = article;
  if (!textContent) textContent = article.content;
  if (!textContent) textContent = html;
  return textContent;
}

/**
 * Start watching local files or re-checking URLs on intervals,
 * re-run on changes if user says yes.
 */
async function startWatching(options, prefixContent, resources) {
  const intervalMs = options.interval * 60_000;
  const prevContentMap = new Map();

  // Initialize watchers
  for (const res of resources) {
    const initial = await getRawResourceContent(res);
    prevContentMap.set(res, hashContent(initial));

    if (!res.startsWith('http')) {
      const watcher = chokidar.watch(res, { ignoreInitial: true, persistent: true });
      watcher.on('change', async () => {
        await handleChange(res, prevContentMap, options, prefixContent, resources);
      });
      watcher.on('error', (err) => {
        if (!options.silent) {
          console.error(`Watcher error: ${err}`);
        }
      });
    }
  }

  // For URLs
  const urlResources = resources.filter((r) => r.startsWith('http'));
  if (urlResources.length > 0) {
    setInterval(async () => {
      for (const urlRes of urlResources) {
        await handleChange(urlRes, prevContentMap, options, prefixContent, resources);
      }
    }, intervalMs);
  }
}

/**
 * On change, compare new hash vs old. If changed, prompt to re-run.
 */
async function handleChange(resource, prevContentMap, options, prefixContent, allResources) {
  const newContent = await getRawResourceContent(resource);
  const newHash = hashContent(newContent);
  const oldHash = prevContentMap.get(resource);

  if (newHash !== oldHash) {
    prevContentMap.set(resource, newHash);
    await askForReRun([resource], options, prefixContent, allResources);
  }
}

/**
 * Ask user if they want to re-run after changes. If yes, re-process and re-append tree if needed.
 */
async function askForReRun(changedResources, options, prefixContent, allResources) {
  if (changedResources.length === 0) return;
  if (!options.silent) {
    console.log('\nThese resources were changed:');
    changedResources.forEach((res) => console.log(res));
    console.log('Do you want to re-run (copy + trim, etc.)? [y/n/x]');
  }

  const answer = await promptUser();
  if (answer.toLowerCase() === 'y') {
    let newFinalOutput = await processFilesAndUrls(options, prefixContent, allResources);
    if (options.tree) {
      const treeResult = buildTreeOutput(allResources, options);
      newFinalOutput += treeResult.rawTree;
      if (!options.silent) {
        console.log(treeResult.coloredTree);
      }
    }

    // Write to file if set
    if (options.output) {
      fs.writeFileSync(options.output, newFinalOutput);
      if (!options.silent) {
        logColored(`Output written to ${options.output}`, chalk.yellow, options);
      }
    }

    // Copy if set
    if (options.copy) {
      clipboardy.writeSync(newFinalOutput);
      if (!options.silent) {
        logColored('Output copied to clipboard', chalk.yellow, options);
      }
    }
  } else if (answer.toLowerCase() === 'x') {
    process.exit(0);
  }
}

/**
 * Basic stdin prompt
 */
function promptUser() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('', (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

/**
 * Hash content with sha256
 */
function hashContent(str) {
  return crypto.createHash('sha256').update(str || '').digest('hex');
}

/**
 * Build a tree (raw + colored) for the given file paths (excluding URLs).
 */
function buildTreeOutput(filePaths, options) {
  const rawTitle = '\n--- Tree View of Processed Files ---\n';
  const coloredTitle = colorize(rawTitle, chalk.cyanBright, options);

  // Convert to absolute, ignoring URLs
  const absPaths = filePaths
    .filter((f) => !f.startsWith('http'))
    .map((f) => path.resolve(process.cwd(), f));

  // Build and print tree
  const treeObject = buildTree(absPaths);
  const { rawTree, coloredTree } = getTreeStrings(treeObject, options, '');

  return {
    rawTree: rawTitle + rawTree + '\n',
    coloredTree: coloredTitle + coloredTree + '\n',
  };
}

/**
 * Build a nested object representing directory structure
 */
function buildTree(files) {
  const root = {};
  for (const f of files) {
    const parts = f.split(path.sep);
    let current = root;
    for (const p of parts) {
      if (!current[p]) {
        current[p] = {};
      }
      current = current[p];
    }
  }
  return root;
}

/**
 * Recursively produce raw and colored strings for the tree
 */
function getTreeStrings(node, options, prefix) {
  let rawTree = '';
  let coloredTree = '';

  const keys = Object.keys(node).sort();
  keys.forEach((key, index) => {
    const isLast = index === keys.length - 1;
    const connector = isLast ? '└── ' : '├── ';

    rawTree += `${prefix}${connector}${key}\n`;
    coloredTree += `${prefix}${colorize(connector, chalk.green, options)}${colorize(key, chalk.green, options)}\n`;

    const nextPrefix = prefix + (isLast ? '    ' : '│   ');
    const sub = getTreeStrings(node[key], options, nextPrefix);
    rawTree += sub.rawTree;
    coloredTree += sub.coloredTree;
  });

  return { rawTree, coloredTree };
}

/**
 * Run main
 */
(async () => {
  try {
    await main();
  } catch (err) {
    console.error('An error occurred:', err);
    process.exit(1);
  }
})();
