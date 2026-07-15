const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

async function test() {
    const SQL = await initSqlJs({
        locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
    });

    const dbPath = 'C:\\Users\\nassa\\AppData\\Roaming\\Electron\\managehub.db';
    if (!fs.existsSync(dbPath)) {
        console.log('Database does not exist!');
        return;
    }
    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('Tables:', tables[0].values.flat());

    try {
        const users = db.exec("SELECT id, name, email, role_id, shop_id FROM users");
        console.log('Users in DB:');
        console.log(users[0] ? users[0].values : 'No users');
    } catch (e) {
        console.error('Error fetching users:', e.message);
    }

    try {
        const shops = db.exec("SELECT id, name, email FROM shops");
        console.log('Shops in DB:');
        console.log(shops[0] ? shops[0].values : 'No shops');
    } catch (e) {
        console.error('Error fetching shops:', e.message);
    }
}

test().catch(console.error);
