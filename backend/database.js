require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log("[GST DB] Connecting to Supabase databases...");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const oldSupabaseUrl = process.env.OLD_SUPABASE_URL;
const oldSupabaseKey = process.env.OLD_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment variables.");
    process.exit(1);
}

const WebSocket = require('ws');
const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { WebSocket },
    realtime: { transport: WebSocket }
});

const oldSupabase = createClient(oldSupabaseUrl, oldSupabaseKey, {
    global: { WebSocket },
    realtime: { transport: WebSocket }
});

console.log('Connected to Supabase clients successfully.');

module.exports = { supabase, oldSupabase };
