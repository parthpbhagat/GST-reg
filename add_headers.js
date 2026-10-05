const fs = require('fs');
let code = fs.readFileSync('frontend/public/script.js', 'utf8');

// 1. GET /api/applications
code = code.replace(
    'const res = await fetch(`${API_BASE_URL}/api/applications`);',
    'const res = await fetch(`${API_BASE_URL}/api/applications`, { headers: { "Authorization": "Bearer " + localStorage.getItem("sb_token") } });'
);

// 2. DELETE /api/applications/:id
code = code.replace(
    'await fetch(`${API_BASE_URL}/api/applications/${id}`, {\r\n            method: \'DELETE\',\r\n        });',
    'await fetch(`${API_BASE_URL}/api/applications/${id}`, {\r\n            method: \'DELETE\',\r\n            headers: { "Authorization": "Bearer " + localStorage.getItem("sb_token") }\r\n        });'
).replace(
    'await fetch(`${API_BASE_URL}/api/applications/${id}`, {\n            method: \'DELETE\',\n        });',
    'await fetch(`${API_BASE_URL}/api/applications/${id}`, {\n            method: \'DELETE\',\n            headers: { "Authorization": "Bearer " + localStorage.getItem("sb_token") }\n        });'
);

// 3. PUT /api/applications/:id/status
code = code.replace(
    'headers: { \'Content-Type\': \'application/json\' },\r\n            body: JSON.stringify({ status })',
    'headers: { \'Content-Type\': \'application/json\', \'Authorization\': \'Bearer \' + localStorage.getItem(\'sb_token\') },\r\n            body: JSON.stringify({ status })'
).replace(
    'headers: { \'Content-Type\': \'application/json\' },\n            body: JSON.stringify({ status })',
    'headers: { \'Content-Type\': \'application/json\', \'Authorization\': \'Bearer \' + localStorage.getItem(\'sb_token\') },\n            body: JSON.stringify({ status })'
);

// 4. POST /api/applications (save missing fields)
code = code.replace(
    'headers: { \'Content-Type\': \'application/json\' },\r\n            body: JSON.stringify({ appId: app.appId, data: app.data })',
    'headers: { \'Content-Type\': \'application/json\', \'Authorization\': \'Bearer \' + localStorage.getItem(\'sb_token\') },\r\n            body: JSON.stringify({ appId: app.appId, data: app.data })'
).replace(
    'headers: { \'Content-Type\': \'application/json\' },\n            body: JSON.stringify({ appId: app.appId, data: app.data })',
    'headers: { \'Content-Type\': \'application/json\', \'Authorization\': \'Bearer \' + localStorage.getItem(\'sb_token\') },\n            body: JSON.stringify({ appId: app.appId, data: app.data })'
);

// 5. PUT /api/applications/:appId/status
code = code.replace(
    'headers: { \'Content-Type\': \'application/json\' },\r\n            body: JSON.stringify({ status: app.status })',
    'headers: { \'Content-Type\': \'application/json\', \'Authorization\': \'Bearer \' + localStorage.getItem(\'sb_token\') },\r\n            body: JSON.stringify({ status: app.status })'
).replace(
    'headers: { \'Content-Type\': \'application/json\' },\n            body: JSON.stringify({ status: app.status })',
    'headers: { \'Content-Type\': \'application/json\', \'Authorization\': \'Bearer \' + localStorage.getItem(\'sb_token\') },\n            body: JSON.stringify({ status: app.status })'
);

// 6. GET /api/applications?t=...
code = code.replace(
    'fetch(`${API_BASE_URL}/api/applications?t=${Date.now()}`)',
    'fetch(`${API_BASE_URL}/api/applications?t=${Date.now()}`, { headers: { "Authorization": "Bearer " + localStorage.getItem("sb_token") } })'
);

// Replace remaining occurences of Content-Type without Authorization in automation endpoints
code = code.replace(/headers: \{ 'Content-Type': 'application\/json' \}/g, "headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('sb_token') }");


fs.writeFileSync('frontend/public/script.js', code);
console.log('done');
