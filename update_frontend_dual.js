const fs = require('fs');

function dualWriteFrontend(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Initialize second client
    if (!content.includes('oldSupabaseClient =')) {
        content = content.replace(
            /const supabaseKey = [\s\S]*?;/,
            `$&
const oldSupabaseUrl = window.ENV.OLD_SUPABASE_URL;
const oldSupabaseKey = window.ENV.OLD_SUPABASE_KEY;`
        );
        content = content.replace(
            /(supabaseClient = window\.supabase\.createClient\(supabaseUrl, supabaseKey\);)/,
            `$1
        oldSupabaseClient = window.supabase.createClient(oldSupabaseUrl, oldSupabaseKey);`
        );
        content = content.replace(/let supabaseClient;/, `let supabaseClient, oldSupabaseClient;`);
        content = content.replace(/const supabaseClient = /, `const supabaseClient = `);
        
        // For login.html & reset-password.html where let/const is different
        if (content.includes('const supabaseClient = window.supabase.createClient')) {
             content = content.replace(
                /(const supabaseClient = window\.supabase\.createClient\(supabaseUrl, supabaseKey\);)/,
                `$1\n        const oldSupabaseClient = window.supabase.createClient(oldSupabaseUrl, oldSupabaseKey);`
            );
        }
    }

    // 2. Dual Write auth signup
    content = content.replace(
        /(const \{ data, error \} = await supabaseClient\.auth\.signUp\(\{ email, password \}\);)/g,
        `$1\n                    await oldSupabaseClient.auth.signUp({ email, password }).catch(e=>console.error(e));`
    );

    // 3. Dual Write insert credentials
    content = content.replace(
        /(await supabaseClient\.from\('user_credentials'\)\.insert\(\[\{ email: email, mobile: mobile, password: password \}\]\);)/g,
        `$1\n                    await oldSupabaseClient.from('user_credentials').insert([{ email: email, mobile: mobile, password: password }]).catch(e=>console.error(e));`
    );

    // 4. Dual Write reset password for email
    content = content.replace(
        /(const \{ data, error \} = await supabaseClient\.auth\.resetPasswordForEmail\(email, \{[\s\S]*?\}\);)/g,
        `$1\n            await oldSupabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password.html' }).catch(e=>console.error(e));`
    );

    // 5. Dual Write update password (reset-password.html)
    content = content.replace(
        /(const \{ data, error \} = await supabaseClient\.auth\.updateUser\(\{ password: newPassword \}\);)/g,
        `$1\n                await oldSupabaseClient.auth.updateUser({ password: newPassword }).catch(e=>console.error(e));`
    );

    // 6. Dual write update user credentials (reset-password.html)
    content = content.replace(
        /(await supabaseClient\.from\('user_credentials'\)\.update\(\{ password: newPassword \}\)\.eq\('email', data\.user\.email\);)/g,
        `$1\n                    await oldSupabaseClient.from('user_credentials').update({ password: newPassword }).eq('email', data.user.email).catch(e=>console.error(e));`
    );

    fs.writeFileSync(filePath, content);
}

['frontend/public/script.js', 'frontend/public/login.html', 'frontend/public/reset-password.html'].forEach(f => {
    dualWriteFrontend(f);
    console.log("Updated", f);
});

