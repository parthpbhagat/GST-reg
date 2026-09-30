const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '../.env' });

const configContent = `window.ENV = { 
    SUPABASE_URL: '${process.env.SUPABASE_URL || 'https://dyqbupgfxdgjbxgwsjjz.supabase.co'}', 
    SUPABASE_KEY: '${process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable__116FzmgxS1kWNlwMqQsMQ_Q97qPXdr'}',
    OLD_SUPABASE_URL: 'https://mgxsxpbrzmcmzlzgzfde.supabase.co',
    OLD_SUPABASE_KEY: 'sb_publishable_159AAeN0gJjlQK7IgozhRQ_5yWUUKmm'
};`;

const configPath = path.join(__dirname, 'public', 'config.js');
fs.writeFileSync(configPath, configContent);
console.log('✅ config.js generated successfully in public/ folder.');
