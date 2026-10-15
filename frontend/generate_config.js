const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '../.env' });

const configContent = `window.ENV = { 
    SUPABASE_URL: '${process.env.SUPABASE_URL || 'https://dyqbupgfxdgjbxgwsjjz.supabase.co'}', 
    SUPABASE_KEY: '${process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable__116FzmgxS1kWNlwMqQsMQ_Q97qPXdr'}',
    OLD_SUPABASE_URL: 'https://mgxsxpbrzmcmzlzgzfde.supabase.co',
    OLD_SUPABASE_KEY: 'sb_publishable_159AAeN0gJjlQK7IgozhRQ_5yWUUKmm',
    GST_API_STATUS: '${process.env.GST_API_STATUS || 'https://reg.gst.gov.in/services/api/ustatus'}',
    GST_API_APP_DRAFT: '${process.env.GST_API_APP_DRAFT || 'https://reg.gst.gov.in/registration/auth/api/appdraftnewreg'}',
    GST_API_SAVE_APP_DRAFT: '${process.env.GST_API_SAVE_APP_DRAFT || 'https://reg.gst.gov.in/registration/auth/api/save/appdraftnewreg'}',
    GST_API_DOC_LEGIBILITY_CONFIG: '${process.env.GST_API_DOC_LEGIBILITY_CONFIG || 'https://reg.gst.gov.in/registration/auth/api/doc-legibility/config'}',
    GST_API_EVC_OTP_SEND: '${process.env.GST_API_EVC_OTP_SEND || 'https://reg.gst.gov.in/registration/auth/api/evc/otp'}'
};`;

const configPath = path.join(__dirname, 'public', 'config.js');
fs.writeFileSync(configPath, configContent);
console.log('✅ config.js generated successfully in public/ folder.');
