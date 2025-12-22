const fs = require('fs');
const lines = fs.readFileSync('app/assets/js/scripts/landing.js', 'utf8').split('\n');
let d = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const opens = (line.match(/\{/g) || []).length;
  const closes = (line.match(/\}/g) || []).length;
  
  d += opens - closes;
  
  if (i > 2700 && opens > closes) {
    console.log('Line ' + (i+1) + ': +' + opens + ' -' + closes + ' (total=' + d + ') => ' + line.substring(0, 80));
  }
}
console.log('Final balance:', d);
