const supabase = require('./database');
async function clear() {
    const { data, error } = await supabase.from('applications').update({ trn: null }).neq('trn', null);
    console.log('Cleared TRNs:', error ? error : 'Success');
    process.exit(0);
}
clear();
