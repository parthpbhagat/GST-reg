const fs = require('fs');
let content = fs.readFileSync('backend/server.js', 'utf8');

// Replace db.from with supabase.from
content = content.replace(/db\.from/g, 'supabase.from');

// Insert oldSupabase upsert for POST /api/applications
content = content.replace(
    /(const \{ error \} = await supabase\.from\('applications'\)\.upsert\(\{[\s\S]*?\}\);)/,
    `$1\n    await oldSupabase.from('applications').upsert({ appId, data, status, userEmail, trn: null }).catch(e=>console.error(e));`
);

// Insert oldSupabase update for PUT /api/applications/:id
content = content.replace(
    /(const \{ error \} = await updateQuery;)/,
    `$1\n\n    let oldUpdateQuery = oldSupabase.from('applications').update({ status, data: appData }).eq('appId', id);\n    if (userEmail) oldUpdateQuery = oldUpdateQuery.eq('userEmail', userEmail);\n    await oldUpdateQuery.catch(e=>console.error(e));`
);

// Insert oldSupabase delete for DELETE /api/applications/:id
content = content.replace(
    /(const \{ error, count \} = await deleteQuery;)/,
    `$1\n\n    let oldDeleteQuery = oldSupabase.from('applications').delete({ count: 'exact' }).eq('appId', id);\n    if (userEmail) oldDeleteQuery = oldDeleteQuery.eq('userEmail', userEmail);\n    await oldDeleteQuery.catch(e=>console.error(e));`
);

// Insert oldSupabase update for PUT /api/applications/:id/trn
content = content.replace(
    /(const \{ error \} = await updateQuery;\s*res\.json\(\{ message: 'TRN updated successfully', trn \}\);)/,
    `let oldUpdateQuery = oldSupabase.from('applications').update({ trn }).eq('appId', id);\n        if (userEmail) oldUpdateQuery = oldUpdateQuery.eq('userEmail', userEmail);\n        await oldUpdateQuery.catch(e=>console.error(e));\n        $1`
);

fs.writeFileSync('backend/server.js', content);
console.log("Updated server.js");
