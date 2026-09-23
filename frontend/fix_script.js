const fs = require('fs');
let code = fs.readFileSync('public/script.js', 'utf8');

// Fix `'`${API_BASE_URL}...`'` -> ````${API_BASE_URL}...````
code = code.replace(/'`\$\{API_BASE_URL\}([^']+)'/g, '`${API_BASE_URL}$1`');
// Fix ````${API_BASE_URL}...```` -> ````${API_BASE_URL}...````
code = code.replace(/``\$\{API_BASE_URL\}([^`]+)`/g, '`${API_BASE_URL}$1`');
// Fix `'`${API_BASE_URL}'` -> ````${API_BASE_URL}````
code = code.replace(/'`\$\{API_BASE_URL\}'/g, '`${API_BASE_URL}`');

const prefix = `const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3002' : 'https://YOUR_BACKEND_URL.onrender.com';\n\n`;

fs.writeFileSync('public/script.js', prefix + code);
