const fs = require('fs');
const files = ['frontend/public/script.js', 'frontend/dist/script.js'];
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/capture="environment" /g, '');
    fs.writeFileSync(file, content);
});
console.log('Removed capture attribute');
