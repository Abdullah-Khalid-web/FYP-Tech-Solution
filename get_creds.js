const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function resetPassword() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'manage_hub'
  });

  try {
    const [users] = await connection.execute('SELECT name, email FROM users LIMIT 1');
    if (users.length === 0) {
      console.log("No users found in the database. You may need to register first at http://localhost:3000/register");
      process.exit(0);
    }

    const user = users[0];
    const newPassword = 'password123';
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await connection.execute('UPDATE users SET password = ? WHERE name = ?', [hashedPassword, user.name]);

    console.log("==== LOGIN CREDENTIALS ====");
    console.log(`Username: ${user.name}`);
    console.log(`Password: ${newPassword}`);
    console.log("===========================");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await connection.end();
  }
}

resetPassword();
