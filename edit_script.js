const fs = require('fs');
const files = ['frontend/public/script.js', 'frontend/dist/script.js'];
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(
        "await oldSupabaseClient.from('user_credentials').insert([{ email: email, mobile: mobile, password: password }]).catch(e=>console.error(e));",
        "try { await oldSupabaseClient.from('user_credentials').insert([{ email: email, mobile: mobile, password: password }]); } catch(e) { console.error(e); }"
    );
    fs.writeFileSync(file, content);
});
console.log('Fixed oldSupabaseClient catch error');
