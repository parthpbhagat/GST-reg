require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');

const oldSupabase = createClient(
    'https://mgxsxpbrzmcmzlzgzfde.supabase.co',
    'sb_publishable_159AAeN0gJjlQK7IgozhRQ_5yWUUKmm'
);

const newSupabaseUrl = process.env.SUPABASE_URL;
// Use service_role or secret key if possible to bypass RLS for migration
const newSupabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

if (!newSupabaseUrl || !newSupabaseKey) {
    console.error("Missing NEW Supabase credentials in .env");
    process.exit(1);
}

const newSupabase = createClient(newSupabaseUrl, newSupabaseKey);

async function migrateData() {
    console.log("🚀 Starting Data Migration...");

    // 1. Migrate user_credentials
    console.log("\n[1] Fetching user_credentials from old DB...");
    const { data: creds, error: credsError } = await oldSupabase.from('user_credentials').select('*');
    if (credsError) {
        console.error("Error fetching user_credentials:", credsError.message);
    } else if (creds && creds.length > 0) {
        console.log(`Found ${creds.length} user_credentials. Inserting to new DB...`);
        const { error: newCredsError } = await newSupabase.from('user_credentials').upsert(creds);
        if (newCredsError) {
            console.error("❌ Error inserting user_credentials (Table might not exist in new DB!):", newCredsError.message);
            console.error("HINT: You need to create the 'user_credentials' table in your new Supabase dashboard first!");
        } else {
            console.log(`✅ Successfully migrated ${creds.length} user_credentials!`);
        }
    } else {
        console.log("No user_credentials found to migrate.");
    }

    // 2. Migrate applications
    console.log("\n[2] Fetching applications from old DB...");
    const { data: apps, error: appsError } = await oldSupabase.from('applications').select('*');
    if (appsError) {
        console.error("Error fetching applications:", appsError.message);
    } else if (apps && apps.length > 0) {
        console.log(`Found ${apps.length} applications. Inserting to new DB...`);
        const { error: newAppsError } = await newSupabase.from('applications').upsert(apps);
        if (newAppsError) {
            console.error("❌ Error inserting applications (Table might not exist in new DB!):", newAppsError.message);
            console.error("HINT: You need to create the 'applications' table in your new Supabase dashboard first!");
        } else {
            console.log(`✅ Successfully migrated ${apps.length} applications!`);
        }
    } else {
        console.log("No applications found to migrate.");
    }
    
    console.log("\n🎉 Migration script finished.");
}

migrateData();
