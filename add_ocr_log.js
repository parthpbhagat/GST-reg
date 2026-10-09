const fs = require('fs');
let content = fs.readFileSync('backend/server.js', 'utf8');
const logEndpoint = `
app.post('/api/log-ocr', (req, res) => {
    console.log('\\n[' + new Date().toISOString() + '] --- NEW OCR PROCESS LOG ---');
    console.log('Document Type:', req.body.type);
    console.log('Extracted Raw Text:', req.body.text);
    if(req.body.extractedData) {
        console.log('Final Extracted Data:', req.body.extractedData);
    }
    console.log('----------------------------------------\\n');
    res.json({ success: true });
});
`;
if(!content.includes('/api/log-ocr')) {
    content = content.replace("app.use(express.json({ limit: '50mb' }));", "app.use(express.json({ limit: '50mb' }));\n" + logEndpoint);
    fs.writeFileSync('backend/server.js', content);
    console.log('Added log endpoint to backend');
} else {
    console.log('Endpoint already exists');
}
