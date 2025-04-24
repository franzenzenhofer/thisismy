#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * thisismy v1.4.0
 *
 * - Added --predefined / -p for a file listing resources (one per line).
 * - Interactive mode can save selected files to a new .thisismy.txt file.
 * - Interactive mode also prompts to load an existing .thisismy.txt if found.
 * - Interactive mode ends with user choosing final action (copy, write, none, etc.).
 * - Removed old alias -p for prefix; use --prefix only.
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

// Extended ignores
const extendedBinaryExtensions = [
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.ico', '.heic',
  '.raw', '.psd', '.ai', '.eps', '.indd', '.cr2', '.nef', '.arw', '.dng', '.orf',
  '.pcx', '.tga', '.icns', '.jxr', '.wdp', '.hdp', '.jng', '.xcf', '.pgm', '.pbm',
  
  // Documents
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.ods', '.odp',
  '.pages', '.numbers', '.key', '.pub', '.one', '.mpp', '.vsd', '.vsdx', '.wp', '.wpd',
  
  // Archives
  '.zip', '.rar', '.7z', '.gz', '.bz2', '.tar', '.xz', '.tgz', '.dmg', '.iso',
  '.cab', '.bz', '.tbz', '.tbz2', '.lz', '.rz', '.lzma', '.tlz', '.txz', '.sit',
  
  // Audio/Video
  '.mp3', '.mp4', '.wav', '.aac', '.m4a', '.ogg', '.flac', '.wma', '.mov', '.avi',
  '.mkv', '.flv', '.webm', '.vob', '.wmv', '.mpg', '.mpeg', '.m4v', '.3gp', 
  '.m2ts', '.mts', '.qt', '.rm', '.rmvb', '.asf', '.divx', '.m2v', '.ogv', '.dv',
  
  // Executables/Libraries
  '.exe', '.dll', '.so', '.dylib', '.bin', '.apk', '.ipa', '.app', '.msi', '.deb',
  '.rpm', '.pkg', '.pyc', '.pyo', '.pyd', '.o', '.ko', '.sys', '.cpl', '.drv',
  '.framework', '.bundle', '.xpi', '.crx', '.plugin', '.air', '.appx', '.snap',
  
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot', '.pfm', '.pfb', '.pcf',
  '.fon', '.tfm',
  
  // Other binary
  '.bak', '.pyc', '.pyo', '.o', '.obj', '.lib', '.a', '.class', '.jar',
  '.dat', '.db', '.sqlite', '.mdb', '.accdb', '.ldf', '.mdf', '.ndf', '.frm', '.ibd',
  '.sav', '.gho', '.wim', '.qcow', '.vdi', '.vmdk', '.hdd',
  
  // Design files
  '.sketch', '.fig', '.xd', '.blend', '.c4d', '.max', '.mb', '.ma', '.hip', '.hda',
  '.zbr', '.zpr', '.stl', '.obj', '.fbx', '.dae', '.3ds', '.dwg', '.dxf', '.skp',
  
  // Database/Cache
  '.cache', '.idx', '.pack', '.sqlite3', '.myd', '.myi', '.gdb', '.fdb'
];

const defaultIgnores = [
  'node_modules/**',
  'package-lock.json',
  '.*',
  '**/.*',
  ...extendedBinaryExtensions.map((ext) => `*${ext}`)
];

// -----------------------------------------------------------------------------
// CLI options
// -----------------------------------------------------------------------------
const optionDefinitions = [
  { name: 'copy', alias: 'c', type: Boolean, description: 'Copy output to clipboard' },
  { name: 'tiny', alias: 't', type: Boolean, description: 'Trim extra spaces' },
  // prefix no longer has alias -p to avoid collision with --predefined
  { name: 'prefix', /* alias: 'x', */ type: String, description: 'Prefix for the output (no short alias)' },
  { name: 'output', alias: 'o', type: String, description: 'Write output to a file' },
  { name: 'help', alias: 'h', type: Boolean, description: 'Print usage help' },
  { name: 'silent', alias: 's', type: Boolean, description: 'Silent output' },
  { name: 'debug', alias: 'd', type: Boolean, description: 'Debug mode' },
  { name: 'version', alias: 'V', type: Boolean, description: 'Print version number' },
  {
    name: 'license',
    type: Boolean,
    description: 'Print license and exit (conflict with -l limit if used incorrectly)'
  },
  { name: 'noColor', alias: 'n', type: Boolean, description: 'Disable colored output' },
  { name: 'backup', alias: 'b', type: Boolean, description: 'Backup current args to thisismy.json' },
  { name: 'watch', alias: 'w', type: Boolean, description: 'Watch for changes' },
  { name: 'interval', alias: 'i', type: Number, description: 'Minutes to re-check URLs (default 5)' },
  { name: 'greedy', alias: 'g', type: Boolean, description: 'Ignore ignore rules' },
  { name: 'recursive', alias: 'r', type: Boolean, description: 'Recurse subdirectories' },
  { name: 'tree', alias: 'y', type: Boolean, description: 'Append directory tree to output' },
  { name: 'interactive', type: Boolean, description: 'Interactively confirm included files' },
  { name: 'stats', type: Boolean, description: 'Show file stats (size, lines, mod time)' },
  { name: 'format', type: String, description: 'md|txt|json|html (default md)' },
  { name: 'treeOnly', type: Boolean, description: 'Output only directory tree, no file content' },
  {
    name: 'limit',
    alias: 'l',
    type: String,
    description: 'Skip files larger than this size (e.g. 2mb or no). Default 1mb'
  },
  {
    name: 'predefined',
    alias: 'p',
    type: String,
    description: 'Path to a .thisismy.txt (or any .txt) listing resources, one per line'
  },
  {
    name: 'file',
    multiple: true,
    defaultOption: true,
    type: String,
    description: 'Files/URLs to read, unless --predefined is used'
  }
];

// For fetch
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

async function main() {
  let options = commandLineArgs(optionDefinitions);
  handleBackup(options);

  // Default if no args
  if (
    Object.keys(options).length === 0 ||
    (Object.keys(options).length === 1 && options.file === undefined)
  ) {
    options = {
      copy: true,      // -c
      recursive: true, // -r
      tree: true,     // -y
      file: ['*']
    };
  }

  const { finalOptions, loadedDefaults } = loadDefaults(options);
  options = finalOptions;

  if (!options.silent && Object.keys(loadedDefaults).length > 0) {
    displayDefaultsUsed(loadedDefaults, options);
  }

  // license vs limit
  if (options.license && typeof options.limit !== 'string') {
    printLicense();
    return;
  }

  if (options.version) {
    printVersion();
    return;
  }
  if (options.help) {
    printUsage();
    return;
  }

  // If user gave --predefined, we skip normal "file" input patterns
  let usingPredefined = false;
  let linesFromPredefined = [];
  if (options.predefined) {
    usingPredefined = true;
    try {
      const fileData = fs.readFileSync(options.predefined, 'utf8');
      linesFromPredefined = fileData
        .split('\n')
        .map((x) => x.trim())
        .filter((x) => x.length > 0 && !x.startsWith('#'));
      if (!linesFromPredefined.length) {
        throw new Error('No valid lines found in predefined file');
      }
    } catch (err) {
      console.error(`Error loading predefined resources from "${options.predefined}":\n${err}`);
      return;
    }
  }

  // If user had no file patterns but no --predefined => error
  if (!usingPredefined) {
    if (options.recursive && (!options.file || options.file.length === 0)) {
      options.file = ['*'];
    } else if (!options.file || options.file.length === 0) {
      console.error('Error: No file specified and no --predefined used');
      printUsage();
      return;
    }
  }

  // Interval default
  if (!options.interval || options.interval < 1) {
    options.interval = 5;
  }

  // Parse limit
  const sizeLimitInfo = parseSizeLimit(options.limit);
  const sizeLimitBytes = sizeLimitInfo.bytes;
  if (options.debug && !options.silent) {
    console.log('Options:', options);
    console.log('Size limit in bytes:', sizeLimitBytes);
  }

  // Possibly list subdirectories if recursive
  if (options.recursive && !options.silent && !usingPredefined) {
    // This listing only makes sense if we're actually scanning patterns
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

  // prefix file content
  const prefixContent = loadPrefixContent(options.prefix);

  // if usingPredefined, we skip normal resource resolution
  let finalResources = [];
  let directoriesScanned = [];
  if (usingPredefined) {
    finalResources = linesFromPredefined.map((ln) => ln.trim());
    directoriesScanned = [...new Set(finalResources.map((f) => path.dirname(f)))];
  } else {
    // normal resolution
    const resolved = await resolveResources(options);
    finalResources = resolved.finalResources;
    directoriesScanned = resolved.directoriesScanned;
  }

  // Interactive mode addition: if there's a .thisismy.txt present, ask user if they want to load it
  // (only if not using --predefined and user actually typed --interactive)
  let extraPredefLines = [];
  if (options.interactive && !usingPredefined) {
    const localTxt = '.thisismy.txt';
    if (fs.existsSync(localTxt)) {
      const want = await askYesNo(`Found a local "${localTxt}". Load its lines into your selection? (y/n)`);
      if (want) {
        try {
          const lines = fs.readFileSync(localTxt, 'utf8')
            .split('\n')
            .map((x) => x.trim())
            .filter((x) => x.length > 0 && !x.startsWith('#'));
          extraPredefLines = lines;
          if (!options.silent) {
            console.log(`Loaded ${lines.length} lines from .thisismy.txt`);
          }
        } catch {
          console.log(`Error reading ${localTxt}`);
        }
      }
    }
  }

  // Combine finalResources + extraPredefLines, removing duplicates
  finalResources.push(...extraPredefLines);
  finalResources = [...new Set(finalResources)];

  // Interactive select
  if (options.interactive) {
    finalResources = await interactiveSelect(finalResources, options);
    // Now ask user if they want to save the selection as .thisismy.txt
    if (finalResources.length > 0) {
      const wantSave = await askYesNo('Save this selection to a .thisismy.txt for future use? (y/n)');
      if (wantSave) {
        const name = `selection-${Date.now()}.thisismy.txt`;
        try {
          fs.writeFileSync(name, finalResources.join('\n'), 'utf8');
          console.log(`Saved selection to "${name}"`);
        } catch (err) {
          console.log(`Error saving selection: ${err}`);
        }
      }
    }

    // At the end of interactive mode, ask what user wants to do with the selected files
    const action = await askPostAction();
    if (action === 'quit') {
      if (!options.silent) {
        console.log('Exiting without further processing...');
      }
      return;
    } else if (action === 'copy' || action === 'file') {
      // We continue with normal processing, but we will override copy or output
      if (action === 'copy') {
        options.copy = true;
      } else if (action === 'file') {
        // ask user for file name
        const outName = await askInput('Enter output filename (default "out.txt"): ');
        options.output = outName.trim() || 'out.txt';
      }
    } else {
      // 'none' means no copy/no file
      options.copy = false;
      options.output = null;
    }
  }

  // treeOnly => skip reading
  if (options.treeOnly) {
    if (!options.silent) {
      console.log('Tree-only mode: No file content read.');
    }
    if (finalResources.length === 0 && !options.silent) {
      console.log('No files/URLs found.');
    } else {
      const treeResult = buildTreeOutput(finalResources, options);
      if (options.output) {
        fs.writeFileSync(options.output, treeResult.rawTree);
        if (!options.silent) {
          logColored(`Output written to ${options.output}`, chalk.yellow, options);
        }
      }
      if (!options.silent) {
        console.log(treeResult.coloredTree);
      }
      if (options.copy) {
        clipboardy.writeSync(treeResult.rawTree);
        if (!options.silent) {
          logColored('Output copied to clipboard', chalk.yellow, options);
        }
      }
    }
    return;
  }

  // apply size limit
  const { finalResourcesFiltered, ignoredDueToSize } = applySizeLimit(finalResources, sizeLimitBytes);
  finalResources = finalResourcesFiltered;

  if (finalResources.length === 0) {
    if (!options.silent) {
      console.log('No files/URLs remain after ignoring or size limit.');
      if (ignoredDueToSize.length > 0) {
        console.log('Ignored due to size limit:');
        ignoredDueToSize.forEach((info) => {
          console.log(` - ${info.filePath} (${info.sizeMB.toFixed(2)} MB)`);
        });
      }
    }
    return;
  }

  // If normal scanning used
  if (options.recursive && !usingPredefined && !options.silent) {
    console.log('Recursive search enabled. Directories scanned:');
    directoriesScanned.forEach((dir) => console.log(`  ${dir}`));
    console.log(`Found ${finalResources.length} file(s)/URL(s) total (after size filtering).`);
  }

  // process resources
  let finalOutput = await processFilesAndUrls(options, prefixContent, finalResources);

  // append tree if -y
  if (options.tree) {
    const treeResult = buildTreeOutput(finalResources, options);
    finalOutput += treeResult.rawTree;
    if (!options.silent) {
      console.log(treeResult.coloredTree);
    }
  }

  // show ignored size
  if (ignoredDueToSize.length > 0 && !options.silent) {
    console.log(`\nSkipped ${ignoredDueToSize.length} file(s) due to size limit:`);
    ignoredDueToSize.forEach((info) => {
      console.log(` - ${info.filePath} (${info.sizeMB.toFixed(2)} MB)`);
    });
    console.log('');
  }

  // write output if requested
  if (options.output) {
    fs.writeFileSync(options.output, finalOutput);
    if (!options.silent) {
      logColored(`Output written to ${options.output}`, chalk.yellow, options);
    }
  }

  // copy if requested
  if (options.copy) {
    clipboardy.writeSync(finalOutput);
    if (!options.silent) {
      logColored('Output copied to clipboard', chalk.yellow, options);
    }
  }

  // watch
  if (options.watch) {
    await startWatching(options, prefixContent, finalResources);
    if (!options.silent) {
      console.log('Watch mode enabled. Press "x" then ENTER to exit watch mode.');
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
}

/** Ask user yes/no, return true if yes */
async function askYesNo(promptStr) {
  process.stdout.write(`${promptStr} `);
  const ans = await promptUser();
  return ans.trim().toLowerCase().startsWith('y');
}

/** Ask user for a line of input */
async function askInput(promptStr) {
  process.stdout.write(promptStr);
  const ans = await promptUser();
  return ans;
}

/** Prompt user for end-of-interactive action */
async function askPostAction() {
  console.log('\nWhat do you want to do with the selected files?');
  console.log(' [1] Copy to clipboard\n [2] Write to file\n [3] None\n [x] Quit');
  process.stdout.write('Choose 1/2/3/x: ');
  const ans = await promptUser();
  switch (ans.trim()) {
    case '1': return 'copy';
    case '2': return 'file';
    case '3': return 'none';
    case 'x':
    case 'q': return 'quit';
    default: return 'none'; // fallback
  }
}

/** Backup current options */
function handleBackup(options) {
  if (options.backup) {
    const backupOptions = { ...options };
    delete backupOptions.backup;
    fs.writeFileSync('thisismy.json', JSON.stringify(backupOptions, null, 2));
  }
}

/** Load defaults from thisismy.json */
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

/** Display loaded defaults */
function displayDefaultsUsed(loadedDefaults, options) {
  const defaultsStr = JSON.stringify(loadedDefaults, null, 2);
  const msg = `Using defaults from thisismy.json:\n${defaultsStr}`;
  logColored(msg, chalk.cyanBright, options);
}

/** Print license */
function printLicense() {
  console.log('MIT License');
}

/** Print version from package.json */
function printVersion() {
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  console.log(`thisismy ${pkg.version}`);
}

/** Print usage */
function printUsage() {
  const usage = commandLineUsage([
    {
      header: 'thisismy',
      content: 'Concatenate file/URL content with various options, ignoring rules, etc. Now with -p for predefined.'
    },
    {
      header: 'Options',
      optionList: optionDefinitions
    }
  ]);
  console.log(usage);
}

/** load prefix content from file or string */
function loadPrefixContent(prefix) {
  if (!prefix) return '';
  if (fs.existsSync(prefix)) {
    return fs.readFileSync(prefix, 'utf8');
  }
  return prefix;
}

/** resolve resources from user patterns, ignoring rules */
async function resolveResources(options) {
  const inputPaths = options.file;
  const ig = ignore(); // Re-introduce the ignore instance
  let globIgnorePatterns = []; // Basic patterns for globSync

  // Load all ignore patterns into the 'ignore' instance if not greedy
  if (!options.greedy) {
    ig.add(defaultIgnores);
    // Define a minimal set for globSync to prevent deep recursion issues
    globIgnorePatterns = defaultIgnores.filter(p => p.includes('node_modules') || p.includes('**/.*') || p.startsWith('.*'));

    const loadIgnores = (filePath) => {
      if (fs.existsSync(filePath)) {
        ig.add(fs.readFileSync(filePath, 'utf8'));
      }
    };

    if (fs.existsSync('.thisismyignore')) {
      loadIgnores('.thisismyignore');
    } else if (fs.existsSync('.gitignore')) {
      loadIgnores('.gitignore');
    }
  }

  const allMatchedFiles = [];
  const finalResourcesInput = []; // To collect URLs separately
  const allIgnoredFiles = []; // To log ignored files

  for (let pattern of inputPaths) {
    if (pattern.startsWith('http')) {
      finalResourcesInput.push(pattern);
      continue;
    }

    if (options.recursive && !pattern.includes('**')) {
      if (pattern.startsWith('./')) {
        pattern = `./**/${pattern.slice(2)}`;
      } else if (!pattern.startsWith('**/')) {
        pattern = `**/${pattern}`;
      }
    }

    // Use globSync with minimal ignores
    const globOptions = {
      dot: true,
      ignore: options.greedy ? [] : globIgnorePatterns,
      follow: false,
    };

    try {
      const matched = globSync(pattern, globOptions);
      allMatchedFiles.push(...matched);
    } catch (err) {
       if (!options.silent) {
           console.warn(chalk.yellow(`Warning during globbing pattern "${pattern}": ${err.message}`));
       }
    }
  }

  // Filter results: Check ignore rules *before* lstatSync
  const finalResources = new Set(finalResourcesInput); // Start with URLs
  const directoriesScanned = new Set();
  const uniqueMatchedFiles = [...new Set(allMatchedFiles)];

  for (const p of uniqueMatchedFiles) {
    const relativePath = path.relative(process.cwd(), p);
    // Skip empty paths that might result from relative(cwd, cwd)
    if (!relativePath) continue;

    // Filter with 'ignore' library FIRST
    if (!options.greedy && ig.ignores(relativePath)) {
      allIgnoredFiles.push(relativePath);
      continue; // Skip ignored files before calling lstatSync
    }

    // Only call lstatSync for non-ignored paths
    try {
      const stats = fs.lstatSync(p); // Use original path `p` for lstatSync
      if (stats.isFile()) {
        finalResources.add(relativePath);
        const dirname = path.dirname(relativePath);
        if (dirname && dirname !== '.') {
          directoriesScanned.add(dirname);
        } else if (!dirname || dirname === '.') {
          directoriesScanned.add('.');
        }
      }
      // Ignore directories found by glob
    } catch (err) {
      // Ignore lstatSync errors (permissions, broken links)
      if (options.debug && !options.silent) {
        console.warn(chalk.yellow(`Skipping ${p} during file check: ${err.message}`));
      }
    }
  }

  // Log ignored files if needed
  if (!options.greedy && !options.silent && allIgnoredFiles.length > 0) {
    logColored('Ignored files (based on rules):', chalk.magenta, options);
    for (const ignored of allIgnoredFiles) {
      console.log(`  ${colorize(ignored, chalk.magenta, options)}`);
    }
  }

  return { finalResources: [...finalResources], directoriesScanned: [...directoriesScanned] };
}

/** Interactive selection of matched resources */
async function interactiveSelect(resources, options) {
  if (!resources.length) return [];
  if (!options.silent) {
    console.log(`Interactive mode: ${resources.length} total. Enter to include, "s" skip, "q" quit.\n`);
  }
  const selected = [];
  let i = 0;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const promptLoop = (resolve) => {
    if (i >= resources.length) {
      rl.close();
      resolve();
      return;
    }
    const file = resources[i];
    process.stdout.write(`Include "${file}"? [ENTER=s / q]> `);
    rl.once('line', (ans) => {
      const low = ans.trim().toLowerCase();
      if (low === 's') {
        // skip
      } else if (low === 'q') {
        // quit
        i = resources.length;
      } else {
        // include
        selected.push(file);
      }
      i++;
      promptLoop(resolve);
    });
  };
  await new Promise((resolve) => {
    promptLoop(resolve);
  });
  return selected;
}

/** parse size limit */
function parseSizeLimit(limitArg) {
  if (!limitArg) {
    return { bytes: 1024 * 1024 }; // 1mb
  }
  if (limitArg.toLowerCase() === 'no') {
    return { bytes: undefined };
  }
  const regex = /^(\d+(?:\.\d+)?)(kb|mb)?$/i;
  const match = limitArg.match(regex);
  if (!match) {
    console.error(`Invalid size limit "${limitArg}", defaulting to 1MB`);
    return { bytes: 1024 * 1024 };
  }
  const val = parseFloat(match[1]);
  const unit = match[2] ? match[2].toLowerCase() : 'mb';
  if (unit === 'kb') {
    return { bytes: Math.round(val * 1024) };
  }
  // default mb
  return { bytes: Math.round(val * 1024 * 1024) };
}

/** skip big files if limit is set */
function applySizeLimit(filePaths, sizeLimitBytes) {
  if (sizeLimitBytes === undefined) {
    return { finalResourcesFiltered: filePaths, ignoredDueToSize: [] };
  }
  const finalResourcesFiltered = [];
  const ignoredDueToSize = [];

  for (const file of filePaths) {
    if (file.startsWith('http')) {
      finalResourcesFiltered.push(file);
      continue;
    }
    try {
      const st = fs.statSync(file);
      if (st.size > sizeLimitBytes) {
        ignoredDueToSize.push({
          filePath: file,
          sizeMB: st.size / (1024 * 1024)
        });
      } else {
        finalResourcesFiltered.push(file);
      }
    } catch {}
  }
  return { finalResourcesFiltered, ignoredDueToSize };
}

/** orchestrate final reading+formatting */
async function processFilesAndUrls(options, prefixContent, resources) {
  const entries = [];
  for (const r of resources) {
    const raw = await getRawResourceContent(r);
    const e = transformContent(raw, r, prefixContent, options);
    entries.push(e);
  }
  if (options.stats) {
    for (const e of entries) {
      if (!e.isURL) {
        try {
          const st = fs.statSync(e.resourceName);
          e.size = st.size;
          e.mtime = st.mtime;
          e.lineCount = (e.rawContent.match(/\n/g) || []).length + 1;
        } catch {}
      }
    }
  }
  const fmt = (options.format || 'md').toLowerCase();
  switch (fmt) {
    case 'txt':
      return formatTxt(entries, options);
    case 'json':
      return formatJson(entries);
    case 'html':
      return formatHtml(entries, options);
    default:
      return formatMarkdown(entries, options);
  }
}

async function getRawResourceContent(resource) {
  if (resource.startsWith('http')) {
    return await fetchURL(resource);
  }
  try {
    return fs.readFileSync(resource, 'utf8');
  } catch {
    return '';
  }
}

function transformContent(raw, resourceName, prefixContent, options) {
  const now = new Date();
  const dateStr = formatDate(now);
  const isURL = resourceName.startsWith('http');
  let content = raw;
  if (options.tiny) {
    content = content.replace(/\s+/g, ' ').trim();
  }
  const header = `\n\nThis is the ${isURL ? 'current' : 'my current'} ${resourceName} at ${dateStr}\n\n`;
  const footer = `\n\nThis is the end of ${resourceName}\n\n`;

  const finalRaw = prefixContent + header + content + footer;
  return {
    resourceName,
    isURL,
    rawContent: content,
    prefixContent,
    header,
    footer,
    finalRaw
  };
}

/** format markdown */
function formatMarkdown(entries, options) {
  let out = '';
  for (const e of entries) {
    if (!options.silent) {
      console.log(
        colorize(e.prefixContent, chalk.green, options) +
        colorize(e.header, chalk.blue, options) +
        colorize(e.rawContent, chalk.green, options) +
        colorize(e.footer, chalk.blue, options)
      );
    }
    out += e.finalRaw;
    if (options.stats && !e.isURL && typeof e.size === 'number') {
      const sizeKB = (e.size / 1024).toFixed(2);
      out += `\n[Stats] lines=${e.lineCount || '?'}, size=${sizeKB}KB, mod=${e.mtime || '?'}\n`;
    }
  }
  return out;
}

/** format txt */
function formatTxt(entries, options) {
  let out = '';
  for (const e of entries) {
    if (!options.silent) {
      console.log(`${e.resourceName}:`);
      console.log(e.rawContent);
    }
    out += `File: ${e.resourceName}\n${e.rawContent}\n`;
    if (options.stats && !e.isURL && typeof e.size === 'number') {
      const sizeKB = (e.size / 1024).toFixed(2);
      out += `[Stats] lines=${e.lineCount || '?'} size=${sizeKB}KB mod=${e.mtime || '?'}\n`;
    }
    out += '\n';
  }
  return out;
}

/** format json */
function formatJson(entries) {
  const arr = entries.map((e) => {
    const o = {
      resource: e.resourceName,
      content: e.rawContent
    };
    if (typeof e.size === 'number') {
      o.sizeBytes = e.size;
    }
    if (typeof e.lineCount === 'number') {
      o.lineCount = e.lineCount;
    }
    if (e.mtime) {
      o.modifiedTime = e.mtime;
    }
    return o;
  });
  return JSON.stringify(arr, null, 2);
}

/** format html */
function formatHtml(entries, options) {
  let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>thisismy Output</title></head><body>\n';
  for (const e of entries) {
    html += `<h2>${escapeHtml(e.resourceName)}</h2>\n<pre>\n${escapeHtml(e.rawContent)}\n</pre>\n`;
    if (options.stats && !e.isURL && typeof e.size === 'number') {
      const sizeKB = (e.size / 1024).toFixed(2);
      html += `<p>[Stats] lines=${e.lineCount || '?'}, size=${sizeKB}KB, mod=${e.mtime || '?'} </p>\n`;
    }
  }
  html += '</body></html>\n';
  return html;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** watchers */
async function startWatching(options, prefixContent, resources) {
  const intervalMs = options.interval * 60000;
  const prevContentMap = new Map();

  for (const r of resources) {
    const initial = await getRawResourceContent(r);
    prevContentMap.set(r, hashContent(initial));
    if (!r.startsWith('http')) {
      const watcher = chokidar.watch(r, { ignoreInitial: true, persistent: true });
      watcher.on('change', async () => {
        await handleChange(r, prevContentMap, options, prefixContent, resources);
      });
      watcher.on('error', (err) => {
        if (!options.silent) {
          console.error('Watcher error:', err);
        }
      });
    }
  }
  const urlResources = resources.filter((x) => x.startsWith('http'));
  if (urlResources.length > 0) {
    setInterval(async () => {
      for (const u of urlResources) {
        await handleChange(u, prevContentMap, options, prefixContent, resources);
      }
    }, intervalMs);
  }
}

/** on file change re-run */
async function handleChange(r, prevMap, options, prefixContent, allResources) {
  const newContent = await getRawResourceContent(r);
  const newHash = hashContent(newContent);
  const oldHash = prevMap.get(r);
  if (newHash !== oldHash) {
    prevMap.set(r, newHash);
    await askForReRun([r], options, prefixContent, allResources);
  }
}

/** ask for re-run if changed */
async function askForReRun(changed, options, prefixContent, allResources) {
  if (!changed.length) return;
  if (!options.silent) {
    console.log('\nThese resources changed:');
    changed.forEach((c) => console.log(c));
    console.log('Re-run now? [y/n/x]');
  }
  const ans = await promptUser();
  if (ans.toLowerCase() === 'y') {
    let newOutput = await processFilesAndUrls(options, prefixContent, allResources);
    if (options.tree) {
      const treeResult = buildTreeOutput(allResources, options);
      newOutput += treeResult.rawTree;
      if (!options.silent) {
        console.log(treeResult.coloredTree);
      }
    }
    if (options.output) {
      fs.writeFileSync(options.output, newOutput);
      if (!options.silent) {
        logColored(`Output written to ${options.output}`, chalk.yellow, options);
      }
    }
    if (options.copy) {
      clipboardy.writeSync(newOutput);
      if (!options.silent) {
        logColored('Output copied to clipboard', chalk.yellow, options);
      }
    }
  } else if (ans.toLowerCase() === 'x') {
    process.exit(0);
  }
}

function promptUser() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function hashContent(str) {
  return crypto.createHash('sha256').update(str || '').digest('hex');
}

/** build directory tree output */
function buildTreeOutput(filePaths, options) {
  const rawTitle = '\n--- Tree View of Processed Files ---\n';
  const coloredTitle = colorize(rawTitle, chalk.cyanBright, options);
  const absPaths = filePaths.filter((f) => !f.startsWith('http')).map((f) => path.resolve(process.cwd(), f));
  const treeObj = buildTree(absPaths);
  const { rawTree, coloredTree } = getTreeStrings(treeObj, options, '');
  return {
    rawTree: rawTitle + rawTree + '\n',
    coloredTree: coloredTitle + coloredTree + '\n'
  };
}

function buildTree(files) {
  const root = {};
  for (const f of files) {
    const parts = f.split(path.sep);
    let current = root;
    for (const p of parts) {
      if (!current[p]) current[p] = {};
      current = current[p];
    }
  }
  return root;
}

function getTreeStrings(node, options, prefix) {
  let rawTree = '';
  let coloredTree = '';
  const keys = Object.keys(node).sort();
  keys.forEach((key, idx) => {
    const isLast = idx === keys.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    rawTree += `${prefix}${connector}${key}\n`;
    coloredTree += prefix +
      colorize(connector, chalk.green, options) +
      colorize(key, chalk.green, options) + '\n';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');
    const sub = getTreeStrings(node[key], options, nextPrefix);
    rawTree += sub.rawTree;
    coloredTree += sub.coloredTree;
  });
  return { rawTree, coloredTree };
}

function colorize(str, colorFunc, options) {
  if (options.silent || options.noColor) return str;
  return colorFunc(str);
}

function logColored(msg, colorFunc, options) {
  if (!options.silent) {
    if (options.noColor) {
      console.log(msg);
    } else {
      console.log(colorFunc(msg));
    }
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

/** fetch with fallback to puppeteer */
async function fetchURL(url, tryJS = false) {
  if (!tryJS) {
    try {
      const resp = await fetch(url, fetchOptions);
      const html = await resp.text();
      const parsed = parseHTMLWithReadability(html);
      if (!parsed) {
        return fetchURL(url, true);
      }
      return parsed;
    } catch (err) {
      console.error(err);
      return '';
    }
  }
  // fallback puppeteer
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

function parseHTMLWithReadability(html) {
  const dom = new JSDOM(html);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article) return null;
  let { textContent } = article;
  if (!textContent) textContent = article.content;
  if (!textContent) textContent = html;
  return textContent;
}

(async () => {
  try {
    await main();
  } catch (err) {
    console.error('An error occurred:', err);
    process.exit(1);
  }
})();
