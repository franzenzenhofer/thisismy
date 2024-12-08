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



import ignore from 'ignore'; // npm install ignore

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

  let prefixContent = '';
  if (options.prefix) {
    if (fs.existsSync(options.prefix)) {
      prefixContent = fs.readFileSync(options.prefix, 'utf8');
    } else {
      prefixContent = options.prefix;
    }
  }

  // Resolve files and URLs to process, applying ignore rules if necessary
  const { finalResources, isSingleExactFile } = await resolveResources(options);

  if (finalResources.length === 0) {
    if (!options.silent) console.log('No files/URLs after applying ignore rules.');
    return;
  }

  await processFilesAndUrls(options, prefixContent, finalResources);

  if (options.watch) {
    await startWatching(options, prefixContent, finalResources);
  }
}

function handleBackup(options) {
  if (options.backup) {
    const backupOptions = { ...options };
    delete backupOptions.backup;
    fs.writeFileSync('thisismy.json', JSON.stringify(backupOptions));
  }
}

function loadDefaults(options) {
  let defaultOptions = {};
  if (fs.existsSync('thisismy.json')) {
    defaultOptions = JSON.parse(fs.readFileSync('thisismy.json', 'utf8'));
  }
  return { ...defaultOptions, ...options };
}

function printVersion() {
  const packageInfo = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  console.log(`thisismy ${packageInfo.version}`);
}

function printLicense() {
  console.log('MIT License');
}

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
        '- `-S` (subdirectories) searches recursively for matching files.',
        '- `-w` (watch) re-prompts when changes in watched files/URLs occur.',
      ]
    },
    { header: 'Examples', content: [
      { desc: 'Print a single file', example: 'thisismy file.txt' },
      { desc: 'Copy output', example: 'thisismy -c file.txt' },
      { desc: 'Write output to a file', example: 'thisismy -o out.txt file.txt' },
      { desc: 'Use prefix', example: 'thisismy -p prefix.txt file.txt' },
      { desc: 'Watch mode', example: 'thisismy -w *.js' },
      { desc: 'Greedy (no ignoring)', example: 'thisismy -g *.png' },
      { desc: 'Recursive subdirectories', example: 'thisismy -S *.js' }
    ]}
  ]);
  console.log(usage);
}

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

function colorize(str, colorFunc, options) {
  if (options.silent || options.copy || options.output || options.watch) {
    return options.noColor ? str : str;
  }
  if (options.noColor) return str;
  return colorFunc(str);
}

function logColored(msg, colorFunc, options) {
  if (options.noColor) {
    console.log(msg);
  } else {
    console.log(colorFunc(msg));
  }
}

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}:${ss}`;
}

async function startWatching(options, prefixContent, resources) {
  const interval = options.interval * 60 * 1000;
  let prevContentMap = new Map();

  for (const res of resources) {
    const content = await getContent(res, options);
    prevContentMap.set(res, hashContent(content));
    if (!res.startsWith('http')) {
      // fs.watch for local files
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

async function handleChange(resource, prevContentMap, options, prefixContent, allResources) {
  const newContent = await getContent(resource, options);
  const newHash = hashContent(newContent);
  const oldHash = prevContentMap.get(resource);
  if (newHash !== oldHash) {
    prevContentMap.set(resource, newHash);
    await askForReRun([resource], options, prefixContent, allResources);
  }
}

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
    process.exit(0);
  }
}

function promptUser() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('', (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

async function getContent(resource, options) {
  if (resource.startsWith('http')) {
    return await fetchURL(resource);
  } else {
    return fs.readFileSync(resource, 'utf8');
  }
}

function hashContent(str) {
  return crypto.createHash('sha256').update(str || '').digest('hex');
}

/**
 * Resolve resources:
 * - If a single exact file is given (no wildcard, no multiple files), ignoring rules do not apply.
 * - Otherwise, gather files/URLs, apply ignores unless -g is used.
 * - If -S is set, also recurse into subdirectories.
 * - For URLs, no ignoring applies since they are not files on disk.
 * - If multiple patterns, use glob to expand them, then filter via ignore rules.
 */
async function resolveResources(options) {
  const inputPaths = options.file;
  const hasWildcard = inputPaths.some(p => p.includes('*'));
  const multipleFiles = inputPaths.length > 1;
  const isSingleExactFile = !multipleFiles && !hasWildcard && inputPaths.length === 1 && !inputPaths[0].startsWith('http');

  // If single exact file and not URL, just return it as is (unless it's missing)
  if (isSingleExactFile && !options.greedy) {
    const singleFile = inputPaths[0];
    if (fs.existsSync(singleFile) || singleFile.startsWith('http')) {
      return { finalResources: [singleFile], isSingleExactFile: true };
    } else {
      return { finalResources: [], isSingleExactFile: true };
    }
  }

  // If multiple patterns or wildcards, or we have URLs, we proceed with globbing and ignoring
  let finalResources = [];

  for (const pth of inputPaths) {
    if (pth.startsWith('http')) {
      // URLs are always included as is, they are not affected by ignore rules
      finalResources.push(pth);
    } else {
      const globOptions = { dot: true };
      let pattern = pth;

      // If -S (subdirectories) is set, we can use a pattern like '**/*.js'
      if (options.subdirectories && !pattern.includes('**')) {
        // If user doesn't provide **, we assume they want recursion
        // For example, '*.js' becomes '**/*.js'
        const parsed = path.parse(pattern);
        if (!pattern.startsWith('**/')) {
          if (pattern.startsWith('./')) {
            pattern = './**/' + pattern.slice(2);
          } else {
            pattern = '**/' + pattern;
          }
        }
      }

      const matches = globSync(pattern, globOptions);
      finalResources.push(...matches);
    }
  }

  // Remove duplicates
  finalResources = Array.from(new Set(finalResources));

  // If -g (greedy) is set, do not apply ignoring rules, skip dotfile and binary ignoring
  if (options.greedy) {
    return { finalResources, isSingleExactFile: false };
  }

  // Determine ignore rules
  const ig = ignore();
  let ignoreFileUsed = false;
  if (fs.existsSync('.thisismyignore')) {
    ig.add(fs.readFileSync('.thisismyignore', 'utf8'));
    ignoreFileUsed = true;
  } else if (fs.existsSync('.gitignore')) {
    ig.add(fs.readFileSync('.gitignore', 'utf8'));
    ignoreFileUsed = true;
  }

  // Default ignoring rules if no ignore file used
  // If no ignore files and multiple files or wildcards given:
  // - Ignore dotfiles
  // - Ignore typical binary files (jpg, jpeg, png, gif, pdf, zip, exe, etc.)
  const defaultBinaryExtensions = ['.png','.jpg','.jpeg','.gif','.pdf','.zip','.rar','.7z','.exe','.dll','.bin','.mp4','.mp3','.wav','.mov','.avi'];
  if (!ignoreFileUsed && (multipleFiles || hasWildcard)) {
    // Add patterns to ignore dotfiles and common binary files if no ignore file
    ig.add('.*');
    for (const ext of defaultBinaryExtensions) {
      ig.add(`*${ext}`);
    }
  }

  // Apply ignore rules to file resources (not URLs)
  const fileResources = finalResources.filter(r => !r.startsWith('http'));
  const urlResources = finalResources.filter(r => r.startsWith('http'));
  const filteredFiles = ig.filter(fileResources);

  // The filtered list excludes ignored files
  finalResources = [...filteredFiles, ...urlResources];

  return { finalResources, isSingleExactFile: false };
}

await run();
