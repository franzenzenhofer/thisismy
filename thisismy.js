#!/usr/bin/env node

import fs from 'fs';
import clipboardy from 'clipboardy';
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import chalk from 'chalk';


const optionDefinitions = [
  { name: 'copy', alias: 'c', type: Boolean, description: 'Copy output to clipboard' },
  { name: 'file', multiple: true, defaultOption: true, type: String, description: 'List of files to read' },
  { name: 'prefix', alias: 'p', type: String, description: 'Prefix for the output. Can be string of file.' },
  { name: 'output', alias: 'o', type: String, description: 'Write output to a file' },
  { name: 'help', alias: 'h', type: Boolean, description: 'Print this usage guide.' },
  { name: 'verbose', alias: 'v', type: Boolean, description: 'Verbose output' },
  { name: 'silent', alias: 's', type: Boolean, description: 'Silent output' },
  { name: 'debug', alias: 'd', type: Boolean, description: 'Debug mode' },
  { name: 'version', alias: 'V', type: Boolean, description: 'Print the version number and exit.' },
  { name: 'license', alias: 'l', type: Boolean, description: 'Print the license and exit.' },
];

function getVersion() {
  console.log('thisismy v1.0.0');
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

function printFileContents(filename, options) {
  const contents = fs.readFileSync(filename, 'utf8');

  const header = '\n\n---\nThis is my current ' + filename + '\n---\n\n';
  const footer = '\n\n---\nThis is the end of ' + filename + '\n';

  const colorize = (str, color) => options.silent ? str : color(str);

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




function run() {
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
  
  let output = '';
  options.file.forEach((filename) => {
    output += printFileContents(filename, options);
  });

  if (!options.silent) {
    console.log(output);
  }

  if (options.output) {
    fs.writeFileSync(options.output, output);
    console.log(chalk.yellow(`Output written to ${options.output}`));
  }
  
  if (options.copy) {
    clipboardy.writeSync(output);
    console.log(chalk.yellow('Output copied to clipboard'));
  }
  
}

run();
