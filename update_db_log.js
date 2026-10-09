const fs = require('fs');
let content = fs.readFileSync('backend/server.js', 'utf8');

const newEndpoint = `app.post('/api/log-ocr', async (req, res) => {
    console.log('\\n[' + new Date().toISOString() + '] --- NEW OCR PROCESS LOG ---');
    console.log('Document Type:', req.body.type);
    console.log('Extracted Raw Text:', req.body.text);
    if(req.body.extractedData) {
        console.log('Final Extracted Data:', req.body.extractedData);
        
        // Save to Supabase
        if(req.body.type === 'pan') {
            const { error } = await supabase.from('ocr_pan_data').insert({
                pan_number: req.body.extractedData.pan || '',
                legal_name: req.body.extractedData.name || '',
                raw_text: req.body.text
            });
            if (error) console.error('Error saving PAN to DB:', error);
            else console.log('✅ PAN data saved to database');
        } else if (req.body.type === 'aadhar') {
            const { error } = await supabase.from('ocr_aadhar_data').insert({
                aadhar_number: req.body.extractedData.aadhar || '',
                pincode: req.body.extractedData.pincode || '',
                raw_text: req.body.text
            });
            if (error) console.error('Error saving Aadhar to DB:', error);
            else console.log('✅ Aadhar data saved to database');
        }
    }
    console.log('----------------------------------------\\n');
    res.json({ success: true });
});`;

content = content.replace(/app\.post\('\/api\/log-ocr'[\s\S]*?\}\);/, newEndpoint);
fs.writeFileSync('backend/server.js', content);
console.log('Backend updated');
