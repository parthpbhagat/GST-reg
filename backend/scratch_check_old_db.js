const { createClient } = require('@supabase/supabase-js');

const oldSupabase = createClient(
    'https://mgxsxpbrzmcmzlzgzfde.supabase.co',
    'sb_publishable_159AAeN0gJjlQK7IgozhRQ_5yWUUKmm'
);

async function checkOldData() {
    console.log("Checking old database data...");
    
    // Check applications
    const { data: apps, error: appsError } = await oldSupabase.from('applications').select('*');
    if (appsError) {
        console.error("Error fetching applications:", appsError.message);
    } else {
        console.log(`Found ${apps.length} applications in old db.`);
    }

    // Check user_credentials
    const { data: creds, error: credsError } = await oldSupabase.from('user_credentials').select('*');
    if (credsError) {
        console.error("Error fetching user_credentials:", credsError.message);
    } else {
        console.log(`Found ${creds ? creds.length : 0} user_credentials in old db.`);
    }
}

checkOldData();
