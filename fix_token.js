const fs = require('fs');
let code = fs.readFileSync('frontend/public/script.js', 'utf8');

const getFreshTokenFn = `
window.getFreshToken = async function() {
    if (!supabaseClient) return localStorage.getItem('sb_token');
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            localStorage.setItem('sb_token', session.access_token);
            return session.access_token;
        }
    } catch(e) {}
    return localStorage.getItem('sb_token');
};
`;

if (!code.includes('window.getFreshToken = async function')) {
    code = code.replace('async function checkAuth() {', getFreshTokenFn + '\nasync function checkAuth() {');
}

code = code.replace(/localStorage\.getItem\(['"]sb_token['"]\)/g, '(await window.getFreshToken())');

// Except we can't replace it in non-async contexts if any.
// Let's check where it's used.
// It's used in checkAuth (async), login (async), but also at the very top:
// let authToken = localStorage.getItem('sb_token');
// Here we can't use await. We'll leave it or replace it back.

fs.writeFileSync('frontend/public/script.js', code);
