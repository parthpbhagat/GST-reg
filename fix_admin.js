const fs = require('fs');

// Backend fix
let beCode = fs.readFileSync('backend/server.js', 'utf8');
const searchAuth = `if (token == null) return res.status(401).json({ error: 'Missing authorization token' });`;
const replaceAuth = `if (token == null) return res.status(401).json({ error: 'Missing authorization token' });

    if (token === 'admin-super-secret-token-xyz') {
        req.user = { id: 'admin', email: 'admin@system.local' };
        return next();
    }`;
beCode = beCode.replace(searchAuth, replaceAuth);
beCode = beCode.replace(searchAuth.replace(/\n/g, '\r\n'), replaceAuth.replace(/\n/g, '\r\n'));
fs.writeFileSync('backend/server.js', beCode);

// Frontend fix
let feCode = fs.readFileSync('frontend/public/script.js', 'utf8');
const searchAdmin = `if (user === 'admin' && pass === 'admin') {
        isAdmin = true;
        closeAdminLogin();
        navigateTo('/admin');
    }`;
const replaceAdmin = `if (user === 'admin' && pass === 'admin') {
        isAdmin = true;
        localStorage.setItem('sb_token', 'admin-super-secret-token-xyz');
        authToken = 'admin-super-secret-token-xyz';
        closeAdminLogin();
        navigateTo('/admin');
    }`;
feCode = feCode.replace(searchAdmin, replaceAdmin);
feCode = feCode.replace(searchAdmin.replace(/\n/g, '\r\n'), replaceAdmin.replace(/\n/g, '\r\n'));

const searchExit = `window.exitAdmin = function () {
    isAdmin = false;
    navigateTo('/form');
};`;
const replaceExit = `window.exitAdmin = function () {
    isAdmin = false;
    localStorage.removeItem('sb_token');
    authToken = null;
    navigateTo('/form');
};`;
feCode = feCode.replace(searchExit, replaceExit);
feCode = feCode.replace(searchExit.replace(/\n/g, '\r\n'), replaceExit.replace(/\n/g, '\r\n'));

fs.writeFileSync('frontend/public/script.js', feCode);
console.log('Fixed admin auth');
