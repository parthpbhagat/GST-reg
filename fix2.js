const fs = require('fs');
let code = fs.readFileSync('frontend/public/script.js', 'utf8');

const loginSearch = `                    let { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                    if (error && error.message.includes('credentials')) {
                        const res2 = await oldSupabaseClient.auth.signInWithPassword({ email, password });
                        if (res2.data && res2.data.session) {
                             data = res2.data;
                             error = null;
                        }
                    }
                    if (error) throw error;`;

const loginReplacement = `                    let { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                    if (error) {
                        const res2 = await oldSupabaseClient.auth.signInWithPassword({ email, password });
                        if (res2.data && res2.data.session) {
                             data = res2.data;
                             error = null;
                        } else if (res2.error && res2.error.message !== 'Invalid login credentials') {
                             error = res2.error;
                        }
                    }
                    if (error) throw error;`;

code = code.replace(loginSearch.replace(/\n/g, '\r\n'), loginReplacement.replace(/\n/g, '\r\n'));
code = code.replace(loginSearch, loginReplacement); // fallback

fs.writeFileSync('frontend/public/script.js', code);
console.log('Done');
