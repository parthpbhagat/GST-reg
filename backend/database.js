const sqlite3 = require('sqlite3').verbose();

console.log("[GST DB] Connecting to local SQLite database...");

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS applications (
            appId TEXT PRIMARY KEY,
            data TEXT,
            status TEXT,
            userEmail TEXT,
            trn TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

module.exports = db;
