const fs = require('fs');
let code = fs.readFileSync('frontend/public/script.js', 'utf8');

const oldFunc = `window.getFreshToken = async function() {
    if (!supabaseClient) return (await window.getFreshToken());
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            localStorage.setItem('sb_token', session.access_token);
            return session.access_token;
        }
    } catch(e) {}
    return (await window.getFreshToken());
};`;

const newFunc = `window.getFreshToken = async function() {
    if (!supabaseClient) return localStorage.getItem('sb_token');
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            localStorage.setItem('sb_token', session.access_token);
            return session.access_token;
        }
    } catch(e) {}
    return localStorage.getItem('sb_token');
};`;

code = code.replace(oldFunc.replace(/\n/g, '\r\n'), newFunc.replace(/\n/g, '\r\n'));
code = code.replace(oldFunc, newFunc); // fallback

fs.writeFileSync('frontend/public/script.js', code);
console.log('Fixed infinite recursion');
