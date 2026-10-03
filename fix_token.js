const fs = require('fs');
let code = fs.readFileSync('frontend/public/script.js', 'utf8');
code = code.replace(
    "'Authorization': 'Bearer ' + localStorage.getItem('token')",
    "'Authorization': 'Bearer ' + authToken"
);
fs.writeFileSync('frontend/public/script.js', code);
console.log('Done');
