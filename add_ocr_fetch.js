const fs = require('fs');

const searchHtml = `        await worker.terminate();`;

const files = ['frontend/public/script.js', 'frontend/dist/script.js'];
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    const startIdx = content.indexOf(searchHtml);
    if(startIdx !== -1 && !content.includes('/api/log-ocr')) {
        const replaceLogic = `        await worker.terminate();
        
        // Send logs to backend for debugging
        try {
            fetch(API_BASE_URL + '/api/log-ocr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: type,
                    text: text,
                    extractedData: foundData ? { pan: window.form.pan, name: window.form.legalName, pincode: window.form.ppob_pincode } : null
                })
            }).catch(e => console.log('Log sending failed'));
        } catch(e) {}
`;
        content = content.replace(searchHtml, replaceLogic);
        fs.writeFileSync(file, content);
    }
});
console.log('Added frontend fetch logic');
