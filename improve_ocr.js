const fs = require('fs');

const searchHtml = `window.processOCR = async function(input, type) {`;
const endHtml = `    }
};`;

const files = ['frontend/public/script.js', 'frontend/dist/script.js'];
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    const startIdx = content.indexOf(searchHtml);
    if(startIdx !== -1) {
        const endIdx = content.indexOf(endHtml, startIdx);
        if(endIdx !== -1) {
            const newCode = `window.processOCR = async function(input, type) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const statusDiv = document.getElementById('ocrStatus');
    statusDiv.innerText = "Scanning " + type.toUpperCase() + " card... Please wait.";
    statusDiv.style.color = "#0369a1";
    
    try {
        if (typeof Tesseract === 'undefined') {
            throw new Error("Tesseract library not loaded.");
        }
        const worker = await Tesseract.createWorker('eng');
        const ret = await worker.recognize(file);
        let text = ret.data.text.toUpperCase();
        console.log("--- OCR RAW TEXT ---");
        console.log(text);
        
        let foundData = false;
        
        if (type === 'pan') {
            let cleanText = text.replace(/[^A-Z0-9\\n ]/g, '');
            const panMatch = cleanText.match(/[A-Z]{5}[0-9]{4}[A-Z]/);
            if (panMatch) {
                window.form.pan = panMatch[0];
                foundData = true;
                
                const lines = cleanText.split('\\n').map(l => l.trim()).filter(l => l.length > 3 && !l.includes('INCOME TAX') && !l.includes('GOVT') && !l.includes('INDIA') && !l.includes('DEPARTMENT') && !l.includes('CARD') && !l.includes('INCOMETAX'));
                if(lines.length > 0) {
                    window.form.legalName = lines[0]; 
                }
            }
        } else if (type === 'aadhar') {
            let cleanText = text.replace(/[^A-Z0-9\\n ]/g, '');
            const aadharMatch = cleanText.replace(/\\s/g, '').match(/[0-9]{12}/);
            if (aadharMatch) {
                foundData = true;
                const pinMatch = cleanText.match(/[0-9]{6}/);
                if(pinMatch) window.form.ppob_pincode = pinMatch[0];
            }
        }
        
        await worker.terminate();
        
        if (foundData) {
            statusDiv.innerText = "Successfully extracted data!";
            statusDiv.style.color = "#15803d";
            setTimeout(() => { window.renderContent(); }, 1500);
        } else {
            statusDiv.innerText = "Could not read clearly. Please upload a clear photo without glare.";
            statusDiv.style.color = "#b91c1c";
        }
    } catch(err) {
        console.error(err);
        statusDiv.innerText = "Error during scanning.";
        statusDiv.style.color = "#b91c1c";
    }
};`;
            content = content.substring(0, startIdx) + newCode + content.substring(endIdx + endHtml.length);
            fs.writeFileSync(file, content);
        }
    }
});
console.log('Improved OCR');
