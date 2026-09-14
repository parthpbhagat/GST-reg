require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log("[GST DB] Connecting to Supabase database...");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment variables.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('Connected to Supabase client successfully.');

module.exports = supabase;
