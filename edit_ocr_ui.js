const fs = require('fs');
let content = fs.readFileSync('frontend/public/script.js', 'utf8');
const searchHtml = `    if (step === 0) {
        html = \`<section class="card">
        <!-- Two-column horizontal layout: Taxpayer left, Business right -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start;">`;

const replaceHtml = `    if (step === 0) {
        html = \`<section class="card">
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
        
        <!-- Two-column horizontal layout: Taxpayer left, Business right -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start;">`;

// Fallback logic for Windows CR/LF and LF
if (content.includes(searchHtml)) {
    content = content.replace(searchHtml, replaceHtml);
} else if (content.includes(searchHtml.replace(/\n/g, '\r\n'))) {
    content = content.replace(searchHtml.replace(/\n/g, '\r\n'), replaceHtml.replace(/\n/g, '\r\n'));
} else {
    console.error("String not found!");
}

fs.writeFileSync('frontend/public/script.js', content);
fs.writeFileSync('frontend/dist/script.js', content);
console.log('Replaced successfully');
