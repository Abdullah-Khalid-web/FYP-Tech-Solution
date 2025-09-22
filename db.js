// db.js
const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'retail',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000 // 10 second timeout

};

const pool = mysql.createPool(dbConfig);

// Test the connection
pool.getConnection()
  .then(conn => {
    console.log('Connected to MySQL!');
    conn.release();
  })
  .catch(err => {
    console.error('MySQL connection error:', err);
  });

module.exports = { pool };



