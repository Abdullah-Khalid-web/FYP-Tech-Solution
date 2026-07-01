const Database = require('better-sqlite3');

const db = new Database('managehub.db');

module.exports = db;