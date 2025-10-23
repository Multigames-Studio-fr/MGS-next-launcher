const fs = require('fs');
const ejs = require('ejs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'app', 'settings.ejs');
const tpl = fs.readFileSync(file, 'utf8');

try {
  ejs.compile(tpl, {filename: file});
  console.log('EJS template compiles OK:', file);
  process.exit(0);
} catch (err) {
  console.error('EJS compile error:', err.message);
  process.exit(2);
}
