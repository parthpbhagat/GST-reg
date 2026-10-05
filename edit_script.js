const fs = require('fs');
let code = fs.readFileSync('frontend/public/script.js', 'utf8');

const s1 = '    stateSpecific_exciseLicenseNo: "", stateSpecific_exciseLicenseHolder: ""\n};';
const r1 = `    stateSpecific_exciseLicenseNo: "", stateSpecific_exciseLicenseHolder: ""\n};\n\nwindow.loadAutosave = function() {\n    try {\n        const saved = localStorage.getItem('gst_autosave');\n        if (saved) {\n            if(confirm('You have an unsaved application form. Do you want to resume it?')) {\n                const parsed = JSON.parse(saved);\n                window.form = Object.assign({}, window.form, parsed);\n                if (typeof renderContent === 'function') renderContent();\n            }\n        }\n    } catch(e) {}\n};\nsetTimeout(window.loadAutosave, 500);\n\nsetInterval(() => {\n    if (window.form && !window.form._appId) {\n        localStorage.setItem('gst_autosave', JSON.stringify(window.form));\n    }\n}, 3000);`;

const s2 = '        if (res.ok) {\n            alert(\'Application Submitted Successfully! It is now pending admin review.\');';
const r2 = `        if (res.ok) {\n            localStorage.removeItem('gst_autosave');\n            alert('Application Submitted Successfully! It is now pending admin review.');`;

code = code.replace(s1.replace(/\n/g, '\r\n'), r1.replace(/\n/g, '\r\n'));
code = code.replace(s2.replace(/\n/g, '\r\n'), r2.replace(/\n/g, '\r\n'));

fs.writeFileSync('frontend/public/script.js', code);
console.log('done');
