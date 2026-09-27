// Lets the taxonomy CLI scripts require the app's ES-module constants (src/**) with the same Babel config Jest uses.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src') + path.sep;
const original = Module._extensions['.js'];
Module._extensions['.js'] = function load(module, filename) {
  if (!filename.startsWith(SRC)) return original(module, filename);
  const { code } = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, configFile: path.join(ROOT, 'jest.babel.config.js'), babelrc: false,
  });
  return module._compile(code, filename);
};

module.exports = { ROOT, requireSrc: (rel) => require(path.join(ROOT, 'src', rel)) };
