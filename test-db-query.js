require('dotenv').config();
process.env.DB_MODE = 'sqlite';
process.env.ELECTRON_START = '1';

const { initDatabase, getDatabase } = require('./electron/database/init');

async function testDatabase() {
  try {
    await initDatabase();
    const db = await getDatabase();
    
    console.log('\n🔍 Testing database queries...\n');
    
    // Test 1: Check if users table has data
    console.log('📋 Users in database:');
    const usersStmt = db.prepare('SELECT id, name, email, status FROM users LIMIT 5');
    const users = [];
    while (usersStmt.step()) {
      users.push(usersStmt.getAsObject());
    }
    usersStmt.free();
    console.log(JSON.stringify(users, null, 2));
    
    // Test 2: Query by email
    console.log('\n🔍 Querying user by email: admin@managehub.com');
    const stmt = db.prepare('SELECT id, name, email, password, shop_id, status FROM users WHERE email = ?');
    stmt.bind(['admin@managehub.com']);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      console.log('Found user:', row);
    }
    stmt.free();
    
    console.log('\n✅ Test complete!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testDatabase();
