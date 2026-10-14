'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Tiny JSON-file store with debounced writes. */
class Store {
  constructor(file, defaults) {
    this.file = file;
    this.timer = null;
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // first run or corrupted file: start from defaults
    }
    this.data = { ...defaults, ...data };
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
