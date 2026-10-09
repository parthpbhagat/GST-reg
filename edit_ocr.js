const fs = require('fs');

const ocrCode = `
window.processOCR = async function(input, type) {
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
        const text = ret.data.text;
        console.log("OCR Text:", text);
        
        let foundData = false;
        
        if (type === 'pan') {
            const panMatch = text.match(/[A-Z]{5}[0-9]{4}[A-Z]{1}/);
            if (panMatch) {
                window.form.pan = panMatch[0];
                foundData = true;
                
                // Try to find Name (heuristic: line before PAN or just above)
                const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 3 && !l.includes('INCOME TAX') && !l.includes('GOVT') && !l.includes('INDIA'));
                if(lines.length > 0) {
                    window.form.legalName = lines[0]; // Guess first valid line as name
                }
            }
        } else if (type === 'aadhar') {
            // Find Aadhar
            const aadharMatch = text.match(/[0-9]{4}\\s[0-9]{4}\\s[0-9]{4}/);
            if (aadharMatch) {
                foundData = true;
                // Currently Step 0 does not have aadhar field, but we can extract other info like State/Pincode if possible
                const pinMatch = text.match(/[0-9]{6}/);
                if(pinMatch) window.form.ppob_pincode = pinMatch[0];
            }
        }
        
        await worker.terminate();
        
        if (foundData) {
            statusDiv.innerText = "Successfully extracted data from " + type.toUpperCase() + "!";
            statusDiv.style.color = "#15803d";
            setTimeout(() => { window.renderContent(); }, 1500);
        } else {
            statusDiv.innerText = "Could not find valid data. Please try a clearer image.";
            statusDiv.style.color = "#b91c1c";
        }
    } catch(err) {
        console.error(err);
        statusDiv.innerText = "Error during scanning: " + err.message;
        statusDiv.style.color = "#b91c1c";
    }
};
`;

const searchHtml = `html = \`<section class="card">
        <!-- Two-column horizontal layout: Taxpayer left, Business right -->`;

const replaceHtml = `html = \`<section class="card">
        <!-- OCR Auto-fill Section -->
        <div style="margin-bottom: 20px; padding: 15px; background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 8px;">
            <h2 style="font-size: 16px; color: #0369a1; margin: 0 0 10px 0; display: flex; align-items: center; gap: 8px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><rect x="7" y="7" width="10" height="10" rx="1"></rect></svg>
                Auto-fill using PAN / Aadhar Card
            </h2>
            <div style="display: flex; gap: 15px;">
                <div style="flex: 1;">
                    <label style="font-size: 13px; font-weight: 600; color: #0c4a6e; display: block; margin-bottom: 5px;">Upload PAN Card (For PAN & Name)</label>
                    <input type="file" accept="image/*" style="font-size: 13px; padding: 6px; border: 1px solid #bae6fd; border-radius: 4px; background: #fff; width: 100%;" onchange="window.processOCR(this, 'pan')">
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 13px; font-weight: 600; color: #0c4a6e; display: block; margin-bottom: 5px;">Upload Aadhar Card</label>
                    <input type="file" accept="image/*" style="font-size: 13px; padding: 6px; border: 1px solid #bae6fd; border-radius: 4px; background: #fff; width: 100%;" onchange="window.processOCR(this, 'aadhar')">
                </div>
            </div>
            <div id="ocrStatus" style="font-size: 13px; color: #0369a1; font-weight: 600; margin-top: 10px; min-height: 18px;"></div>
        </div>
        
        <!-- Two-column horizontal layout: Taxpayer left, Business right -->`;

const files = ['frontend/public/script.js', 'frontend/dist/script.js'];
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    if(!content.includes('window.processOCR')) {
        content = content.replace(searchHtml, replaceHtml);
        content = content + '\n' + ocrCode;
        fs.writeFileSync(file, content);
        console.log('Patched', file);
    }
});
