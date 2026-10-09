const fs = require('fs');
let html = fs.readFileSync('frontend/index.html', 'utf8');
if(!html.includes('tesseract.min.js')) {
    html = html.replace('</head>', '    <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>\n</head>');
    fs.writeFileSync('frontend/index.html', html);
    console.log('Added Tesseract to index.html');
}
