#!/usr/bin/env node

import fs from 'fs';
import clipboardy from 'clipboardy';
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import chalk from 'chalk';

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';



const optionDefinitions = [
  { name: 'copy', alias: 'c', type: Boolean, description: 'Copy output to clipboard' },
  { name: 'tiny', alias: 't', type: Boolean, description: 'Removes double whitespaces from the read files.' },
  { name: 'file', multiple: true, defaultOption: true, type: String, description: 'List of files to read' },
  { name: 'prefix', alias: 'p', type: String, description: 'Prefix for the output. Can be string of file.' },
  { name: 'output', alias: 'o', type: String, description: 'Write output to a file' },
  { name: 'help', alias: 'h', type: Boolean, description: 'Print this usage guide.' },
  { name: 'silent', alias: 's', type: Boolean, description: 'Silent output' },
  { name: 'debug', alias: 'd', type: Boolean, description: 'Debug mode' },
  { name: 'version', alias: 'V', type: Boolean, description: 'Print the version number and exit.' },
  { name: 'license', alias: 'l', type: Boolean, description: 'Print the license and exit.' },
  { name: 'noColor', alias: 'n', type: Boolean, description: 'Disable colorized output' }, // New option definition
];

async function run() {
  const options = commandLineArgs(optionDefinitions);

  if (options.version) {
    getVersion();
    return;
  }

  if (options.license) {
    getLicense();
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }
  
  if (!options.file || options.file.length === 0) {
    console.error('Error: No file specified');
    printUsage();
    return;
  }
  
  if (options.debug) {
    console.log('Options:', options);
  }
  
  options.prefix = options.prefix || '';
  
  let outputArr = [];
  await Promise.all(options.file.map(async (filename) => {
    const contents = await printFileContents(filename, options);
    outputArr.push(contents);
  }));
  const output = outputArr.join('');

  if (!options.silent) {
    console.log(output);
  }

  if (options.output) {
    fs.writeFileSync(options.output, output);
    if (options.noColor) {
      console.log(`Output written to ${options.output}`);
    } else {
      console.log(chalk.yellow(`Output written to ${options.output}`));
    }
  }
  
  if (options.copy) {
    clipboardy.writeSync(output);
    if (options.noColor) {
      console.log('Output copied to clipboard');
    } else {
      console.log(chalk.yellow('Output copied to clipboard'));
    }
  }
  
}



function getVersion() {
  const packageInfo = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  console.log(`thisismy ${packageInfo.version}`);
}

function getLicense() {
  console.log('MIT License');
}




function printUsage() {
  const usage = commandLineUsage([
    {
      header: 'thisismy',
      content: 'A command line utility to print the contents of a list of files.'
    },
    {
      header: 'Options',
      optionList: optionDefinitions
    },
    {
      header: 'Examples',
      content: [
        {
          desc: 'Print the contents of a file to the terminal',
          example: 'thisismy /path/to/file.txt'
        },
        {
          desc: 'Copy the contents of a file to the clipboard',
          example: 'thisismy -c /path/to/file.txt'
        },
        {
          desc: 'Write the contents of a file to a new file',
          example: 'thisismy -o /path/to/newfile.txt /path/to/file.txt'
        },
        {
          desc: 'Specify a prefix for the output',
          example: 'thisismy -p "Prefix for output" /path/to/file.txt'
        }
      ]
    }
  ]);
  console.log(usage);
}

function fetchURL(url) {
  return fetch(url)
    .then((response) => response.text())
    .then((html) => {
      const doc =  new JSDOM(html);
      const reader = new Readability(doc.window.document);
      const article = reader.parse();
      const content = article.textContent;
      return content;
    })
    .catch((error) => console.error(error));
}

async function printFileContents(filename, options) {
  let contents = '';

  let header = '\n\nThis is my current ' + filename + '\n\n';
  let footer = '\n\nThis is the end of ' + filename + '\n\n';

  if (filename.startsWith('http')) {
    contents = await fetchURL(filename);
    header = '\n\nThis is the current ' + filename + '\n\n';
    footer = '\n\nThis is the end of ' + filename + '\n\n';
  } else {
    contents = fs.readFileSync(filename, 'utf8');
  }

  if (options.tiny) {
    contents = contents.replace(/[\s\n]+/g, ' ').trim();
  }



  const colorize = (str, color) => options.silent ? str : options.noColor ? str : color(str);


  const shouldColorize = !options.copy && !options.output && !options.c;
  const coloredContents = shouldColorize ? colorize(contents, chalk.green) : contents;
  const coloredHeader = shouldColorize ? colorize(header, chalk.blue) : header;
  const coloredFooter = shouldColorize ? colorize(footer, chalk.blue) : footer;

  let prefix = options.prefix || '';
  if (fs.existsSync(prefix)) {
    prefix = fs.readFileSync(prefix, 'utf8');
  }

  const prefixedContents = prefix + coloredHeader + coloredContents + coloredFooter;
  if (!options.silent) {
    console.log(`${options.prefix} ${filename}:`);
    console.log(prefixedContents);
  }

  return prefixedContents;
}



await run();