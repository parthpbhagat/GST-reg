require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log("[GST DB] Connecting to Supabase databases...");

const supabaseUrl = process.env.NEW_SUPABASE_URL || 'https://dyqbupgfxdgjbxgwsjjz.supabase.co';
const supabaseKey = process.env.NEW_SUPABASE_KEY || 'sb_publishable__116FzmgxS1kWNlwMqQsMQ_Q97qPXdr';

const oldSupabaseUrl = 'https://mgxsxpbrzmcmzlzgzfde.supabase.co';
const oldSupabaseKey = 'sb_publishable_159AAeN0gJjlQK7IgozhRQ_5yWUUKmm';

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
