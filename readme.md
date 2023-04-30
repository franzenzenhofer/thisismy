# thisismy

`thisismy` is a command line utility that allows you to print the contents of one or more files with a prefix. You can also copy the output to the clipboard or write it to a file.

## Installation

To install the `thisismy` package from GitHub and link it globally, you can follow these steps:

1. Clone the `thisismy` repository from GitHub:

   ```
   git clone https://github.com/franzenzenhofer/thisismy.git
   ```

2. Navigate to the `thisismy` directory:

   ```
   cd thisismy
   ```

3. Install the dependencies:

   ```
   npm install
   ```

4. Link the package globally:

   ```
   npm link
   ```

Now you should be able to use the `thisismy` command anywhere in your terminal.

## Usage

To use `thisismy`, you can run the command followed by the file path(s) you want to print:

```sh
thisismy path/to/file.txt
```

You can also specify multiple file paths:

```sh
thisismy path/to/file1.txt path/to/file2.txt
```

### Options

`thisismy` supports several options:

| Option | Alias | Description |
| ------ | ----- | ----------- |
| `--copy` | `-c` | Copies the output to the clipboard |
| `--file` | | List of files to read |
| `--prefix` | `-p` | Prefix for the output. Can be a string or a file |
| `--output` | `-o` | Writes output to a file |
| `--help` | `-h` | Prints usage information |
| `--verbose` | `-v` | Verbose output |
| `--silent` | `-s` | Silent output |
| `--debug` | `-d` | Debug mode |
| `--version` | `-V` | Prints the version number and exits |
| `--license` | `-l` | Prints the license and exits |

#### Example Usage

Print the contents of a file to the terminal:

```sh
thisismy path/to/file.txt
```

Copy the contents of a file to the clipboard:

```sh
thisismy -c path/to/file.txt
```

Write the contents of a file to a new file:

```sh
thisismy -o path/to/newfile.txt path/to/file.txt
```

Specify a prefix for the output:

```sh
thisismy -p "Prefix for output" path/to/file.txt
```

If you want to use a file as a prefix, you can pass the file path as an argument to the `-p` option. For example:

```
thisismy -p /path/to/prefix.txt /path/to/file.txt
```

This will use the contents of `/path/to/prefix.txt` as the prefix for the output.

## License

`thisismy` is licensed under the MIT License. See [LICENSE](LICENSE) for more information.

##

```
$ thisismy hello-world.js goodbye-world.js -c

---

This is my current hello-world.js

---

//my awesome hello world file
console.log("hello world");

---
This is the end of hello-world.js

---

---

This is my current goodbye-world.js

---

//another comment
console.log("hello world");
//this is also comment

---
This is the end of goodbye-world.js

---

Output copied to clipboard
```







