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
        
        // Setup canvas to preprocess image (grayscale + contrast)
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise(r => img.onload = r);
        
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        
        // Draw image and get data
        ctx.drawImage(img, 0, 0);
        let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let data = imgData.data;
        
        // Simple Grayscale and Thresholding (Binarization) to remove background patterns
        for (let i = 0; i < data.length; i += 4) {
            let avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            let val = avg > 120 ? 255 : 0; // Simple threshold
            data[i] = data[i+1] = data[i+2] = val;
        }
        ctx.putImageData(imgData, 0, 0);
        
        const preprocessedDataUrl = canvas.toDataURL('image/jpeg');

        const worker = await Tesseract.createWorker('eng');
        // Increase PSM to 6 (Assume a single uniform block of text)
        await worker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM.BLOCK,
        });
        
        const ret = await worker.recognize(preprocessedDataUrl);
        let text = ret.data.text.toUpperCase();
        console.log("--- OCR RAW TEXT (Preprocessed) ---");
        console.log(text);
        
        let foundData = false;
        
        if (type === 'pan') {
            let cleanText = text.replace(/[^A-Z0-9\\n ]/g, '');
            const panMatch = cleanText.match(/[A-Z]{5}[0-9]{4}[A-Z]/);
            if (panMatch) {
                window.form.pan = panMatch[0];
                foundData = true;
                
                // Name extraction logic
                const lines = cleanText.split('\\n').map(l => l.trim()).filter(l => l.length > 2);
                let nameFound = false;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes('GOVT') || lines[i].includes('INDIA') || lines[i].includes('GOVERNMENT')) {
                        if (lines[i+1] && lines[i+1].length > 3) {
                            window.form.legalName = lines[i+1];
                            nameFound = true;
                            break;
                        }
                    }
                }
                
                if (!nameFound) {
                    // Fallback to first non-header line
                    const validLines = lines.filter(l => !l.includes('INCOME TAX') && !l.includes('GOVT') && !l.includes('INDIA') && !l.includes('DEPARTMENT') && !l.includes('CARD') && !l.includes('INCOMETAX'));
                    if(validLines.length > 0) {
                        window.form.legalName = validLines[0]; 
                    }
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
console.log('Improved OCR with Canvas preprocessing');
