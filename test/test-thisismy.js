// test-thisismy.js
// Minimal Mocha + Chai test suite in ESM format, fixing the "describe is not defined" error.

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname is not available by default in ESM, so define it:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('thisismy v1.4 Tests', function() {

  // Adjust if your main thisismy.js is located elsewhere
  const BIN = path.resolve(__dirname, '../thisismy.js');

  it('Should show help text', (done) => {
    exec(`${BIN} --help`, (err, stdout, stderr) => {
      expect(err).to.be.null;
      expect(stdout).to.include('Options');
      done();
    });
  });

  it('Should handle predefined file lines', (done) => {
    const predefFile = path.join(__dirname, 'test.thisismy.txt');
    fs.writeFileSync(predefFile, 'hello-world.js\n', 'utf8');

    exec(`${BIN} -p ${predefFile} --silent`, (err, stdout, stderr) => {
      expect(err).to.be.null;
      fs.unlinkSync(predefFile);
      done();
    });
  });

  it('Should skip large files if limit is 1kb', (done) => {
    const bigFile = path.join(__dirname, 'bigfile.txt');
    const content = 'A'.repeat(2048); // 2KB
    fs.writeFileSync(bigFile, content, 'utf8');

    exec(`${BIN} ${bigFile} -l 1kb --silent`, (err) => {
      expect(err).to.be.null;
      fs.unlinkSync(bigFile);
      done();
    });
  });

  // Add more tests as needed...
});
