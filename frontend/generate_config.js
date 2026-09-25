const fs = require('fs');
const path = require('path');

// Fallback to empty string if not provided
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_KEY || process.env.SUPABASE_KEY || '';

const configContent = `window.ENV = { 
    SUPABASE_URL: '${supabaseUrl}', 
    SUPABASE_KEY: '${supabaseKey}' 
};`;

const configPath = path.join(__dirname, 'public', 'config.js');
fs.writeFileSync(configPath, configContent);

console.log('✅ config.js generated successfully in public/ folder.');
