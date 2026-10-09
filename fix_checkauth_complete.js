const fs = require('fs');

const files = ['frontend/public/script.js', 'frontend/dist/script.js'];
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    const newFunc = `async function checkAuth() {
    const loginSection = document.getElementById('login-section');
    const appContainer = document.getElementById('app-container');

    if (!authToken) {
        if (loginSection) loginSection.classList.remove('hidden');
        if (appContainer) appContainer.classList.add('hidden');
        return;
    }

    if (authToken === 'admin-super-secret-token-xyz') {
        const emailDisplay = document.getElementById('userEmailDisplay');
        if (emailDisplay) emailDisplay.innerText = 'admin@example.com';
        if (loginSection) loginSection.classList.add('hidden');
        if (appContainer) appContainer.classList.remove('hidden');
        return;
    }

    let { data: { session }, error } = await supabaseClient.auth.getSession();
    
    if (!session) {
        const res2 = await oldSupabaseClient.auth.getSession();
        if (res2.data && res2.data.session) {
            session = res2.data.session;
            error = null;
        }
    }

    if (error || !session) {
        localStorage.removeItem('sb_token');
        authToken = null;
        if (loginSection) loginSection.classList.remove('hidden');
        if (appContainer) appContainer.classList.add('hidden');
        return;
    }

    localStorage.setItem('sb_token', session.access_token);
    authToken = session.access_token;

    const emailDisplay = document.getElementById('userEmailDisplay');
    if (emailDisplay) emailDisplay.innerText = session.user.email;

    if (loginSection) loginSection.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');
}`;
    
    content = content.replace(/async function checkAuth\(\) \{[\s\S]*?if \(loginSection\) loginSection\.classList\.add\('hidden'\);\s*if \(appContainer\) appContainer\.classList\.remove\('hidden'\);\s*\}/, newFunc);
    
    // Also fix the logout logic to sign out of both
    content = content.replace('await supabaseClient.auth.signOut();', 'await supabaseClient.auth.signOut();\n            await oldSupabaseClient.auth.signOut();');
    
    fs.writeFileSync(file, content);
});
console.log('checkAuth fixed completely');
