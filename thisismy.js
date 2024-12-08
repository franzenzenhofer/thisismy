#!/usr/bin/env node

'use strict';

import fs from 'fs';
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

const optionDefinitions = [
  { name: 'copy', alias: 'c', type: Boolean },
  { name: 'tiny', alias: 't', type: Boolean },
  { name: 'file', multiple: true, defaultOption: true, type: String },
  { name: 'prefix', alias: 'p', type: String },
  { name: 'output', alias: 'o', type: String },
  { name: 'help', alias: 'h', type: Boolean },
  { name: 'silent', alias: 's', type: Boolean },
  { name: 'debug', alias: 'd', type: Boolean },
  { name: 'version', alias: 'V', type: Boolean },
  { name: 'license', alias: 'l', type: Boolean },
  { name: 'noColor', alias: 'n', type: Boolean },
  { name: 'backup', alias: 'b', type: Boolean },
  { name: 'watch', alias: 'w', type: Boolean },
  { name: 'interval', alias: 'i', type: Number }
];

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

  await processFilesAndUrls(options, prefixContent);

  if (options.watch) {
    await startWatching(options, prefixContent);
  }
}

async function processFilesAndUrls(options, prefixContent) {
  const outputArr = [];
  for (const filename of options.file) {
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
    { header: 'thisismy', content: 'A CLI tool.' },
    { header: 'Options', optionList: optionDefinitions },
    { header: 'Examples', content: [
      { desc: 'Print a file', example: 'thisismy file.txt' },
      { desc: 'Copy output', example: 'thisismy -c file.txt' },
      { desc: 'Write output', example: 'thisismy -o out.txt file.txt' },
      { desc: 'Use prefix', example: 'thisismy -p prefix.txt file.txt' },
      { desc: 'Watch mode', example: 'thisismy -w file.txt' }
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

  if (!options.silent && !options.copy && !options.output && !options.watch) {
    console.log(`${options.prefix ? options.prefix : ''} ${filename}:`);
    console.log(finalData);
  }

  return finalData;
}

function colorize(str, colorFunc, options) {
  if (options.silent || options.copy || options.output || options.watch) {
    if (options.noColor) return str;
    return str;
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

async function startWatching(options, prefixContent) {
  const interval = options.interval * 60 * 1000;
  const resources = options.file.slice();
  let prevContentMap = new Map();

  for (const res of resources) {
    const content = await getContent(res, options);
    prevContentMap.set(res, hashContent(content));
    if (!res.startsWith('http')) {
      fs.watch(res, { persistent: true }, async () => {
        await handleChange(res, prevContentMap, options, prefixContent);
      });
    }
  }

  if (resources.some(r => r.startsWith('http'))) {
    setInterval(async () => {
      for (const r of resources.filter(r => r.startsWith('http'))) {
        await handleChange(r, prevContentMap, options, prefixContent);
      }
    }, interval);
  }
}

async function handleChange(resource, prevContentMap, options, prefixContent) {
  const newContent = await getContent(resource, options);
  const newHash = hashContent(newContent);
  const oldHash = prevContentMap.get(resource);
  if (newHash !== oldHash) {
    prevContentMap.set(resource, newHash);
    await askForReRun([resource], options, prefixContent);
  }
}

async function askForReRun(changedResources, options, prefixContent) {
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
    await processFilesAndUrls(options, prefixContent);
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

await run();
