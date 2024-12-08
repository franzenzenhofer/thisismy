# thisismy

A command-line tool to streamline your ChatGPT prompts by concatenating files, URLs, and resources into a single, well-formatted output. It can remove unnecessary whitespace, copy results to your clipboard, apply prefixes from files or strings, and even watch for changes in your resources to prompt for re-runs.

## Key Features

- **Combine Multiple Files/URLs**: Read and concatenate contents from files or URLs into a single output.
- **Whitespace Reduction**: Use `-t` to trim down whitespace, saving tokens and making content more readable.
- **Prefixing**: Apply a custom prefix from a string or file to your final output.
- **Clipboard Copying**: Copy the processed output directly to your clipboard with `-c`.
- **Ignore Rules**: Respect `.thisismyignore` or `.gitignore` files to exclude unwanted files.
- **Watch Mode**: Automatically watch local files or periodically check URLs for changes and prompt to re-run.
- **Backups**: Save your current arguments to `thisismy.json` and use them as defaults next time.

## Installation

**Prerequisites**:  
- **Node.js** (v16+ recommended)
- **npm**

### Quick Start

1. **Clone the Repository**
   ```bash
   git clone https://github.com/franzenzenhofer/thisismy.git
   cd thisismy
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Link the Tool Globally**
   ```bash
   npm link
   ```

After these steps, you can run the `thisismy` command from anywhere on your system.

### Updating the Tool

If you’ve previously installed `thisismy`, simply pull the latest changes, run `npm install` again, and then `npm link` to update the global command.

## Usage

Basic usage:
```bash
thisismy [options] [files/URLs...]
```

Examples:
- Print a single file:
  ```bash
  thisismy file.txt
  ```
- Print multiple files and a URL, trim whitespace, and copy to clipboard:
  ```bash
  thisismy -c -t file1.md file2.js https://example.com
  ```
- Add a prefix from `prefix.md` before all content:
  ```bash
  thisismy -p prefix.md file.txt
  ```
- Write output to `out.txt`:
  ```bash
  thisismy -o out.txt file.txt
  ```
- Watch mode (re-run if files/URLs change):
  ```bash
  thisismy -wc *.js
  ```

## Common Options

| Option          | Alias | Description                                                    |
|-----------------|-------|----------------------------------------------------------------|
| `--help`        | `-h`  | Print usage information                                        |
| `--copy`        | `-c`  | Copy the final output to your clipboard                        |
| `--tiny`        | `-t`  | Remove unnecessary whitespace                                  |
| `--prefix`      | `-p`  | Prefix output with a string or contents of a file              |
| `--output`      | `-o`  | Write output to the specified file                             |
| `--silent`      | `-s`  | Run silently (no console output)                               |
| `--debug`       | `-d`  | Enable debug mode                                              |
| `--version`     | `-V`  | Print the current version number                               |
| `--license`     | `-l`  | Print license information                                      |
| `--noColor`     | `-n`  | Disable colored output                                         |
| `--backup`      | `-b`  | Save the current arguments to `thisismy.json` for future runs  |
| `--watch`       | `-w`  | Watch for file changes or periodically check URLs              |
| `--interval`    | `-i`  | Check URLs every X minutes (default: 5) in watch mode          |
| `--greedy`      | `-g`  | Ignore all ignore rules and include all matched files          |
| `--recursive`   | `-r`  | Recurse into subdirectories when searching for patterns        |

## Ignore Behavior

- If a `.thisismyignore` file is present, it defines what to ignore.
- If not, `.gitignore` is used if available.
- Without ignore files and when dealing with multiple files, `thisismy` ignores common binary files and dotfiles by default (unless `-g` is used).
- A single explicitly named file always bypasses ignore rules unless `-g` is used.

## Examples

- **Combine and trim:**  
  ```bash
  thisismy -t file1.txt file2.txt
  ```
  Removes excessive whitespace and prints combined content.

- **Copy to clipboard and prefix:**  
  ```bash
  thisismy -c -p prefix.md file.txt
  ```
  Copies the combined content (prefixed with `prefix.md` content) directly to your clipboard.

- **Online resource plus local files:**  
  ```bash
  thisismy -t -c file1.js file2.js https://example.com
  ```
  Trims whitespace, copies output to clipboard, and includes main content from the provided URL.

- **Watch mode:**  
  ```bash
  thisismy -w *.js
  ```
  Watches all `.js` files. If any change, you’ll be prompted to re-run and copy+trim again if desired.

## Backup Feature

Use `-b` to create/update `thisismy.json` with your current arguments. On subsequent runs in the same directory, `thisismy` will use these defaults automatically. You can still override them by providing new arguments.

Example:
```bash
thisismy -bct file.txt
```
Creates a `thisismy.json` with `copy=true`, `tiny=true`, and `file=["file.txt"]`. Next time, `thisismy` uses these defaults unless overridden.

```md### Using `-r` (Recursive) Option

When you use the `-r` option, `thisismy` attempts to recursively search through subdirectories to find matching files based on your given pattern. However, one important detail is how your shell interprets wildcard patterns before passing them to `thisismy`.

By default, shells like `bash` or `zsh` will expand unquoted wildcards (e.g., `*`, `*.js`) into a list of files and directories in the current folder **before** `thisismy` sees them. This means that if you run:

```bash
thisismy -r *.vue
```

your shell might replace `*.vue` with a list of files in the current directory, preventing `thisismy` from receiving the intended wildcard pattern. Without the raw pattern, `thisismy` cannot apply its recursive glob logic to find matching files in subdirectories.

**How to Solve This:**

- **Quote Your Patterns**: Enclose your pattern in quotes so the shell doesn't expand it:
  
  ```bash
  thisismy -r '*.vue'
  ```

  Now `thisismy` receives the literal `*.vue` pattern and can recursively search subdirectories for `.vue` files as intended.

## Why Use thisismy?

When working with ChatGPT, you often need to copy multiple files, URLs, or large texts as context. Doing this manually is tedious and prone to errors. `thisismy` automates this process, letting you:

- Concatenate multiple sources into one prompt.
- Remove unnecessary whitespace to save tokens.
- Automatically apply prefixes for clear context.
- Watch for changes to resources and easily re-run.

This leads to a more efficient, consistent, and pleasant workflow.

## License

`thisismy` is licensed under the MIT License. See [LICENSE](LICENSE) for details.







