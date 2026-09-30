const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '../.env' });

const configContent = `window.ENV = { 
    SUPABASE_URL: '${process.env.SUPABASE_URL || ''}', 
    SUPABASE_KEY: '${process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY || ''}',
    OLD_SUPABASE_URL: '${process.env.OLD_SUPABASE_URL || ''}',
    OLD_SUPABASE_KEY: '${process.env.OLD_SUPABASE_KEY || ''}'
};`;

const configPath = path.join(__dirname, 'public', 'config.js');
fs.writeFileSync(configPath, configContent);
console.log('✅ config.js generated successfully in public/ folder.');
