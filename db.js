// db.js
require('dotenv').config();

const crypto = require('crypto');
const mysql = require('mysql2/promise');

const useSqlite = process.env.ELECTRON_START === '1' || process.env.DB_MODE === 'sqlite';

function createSqlitePool() {
  const { initDatabase, getDatabase, persistDatabase } = require('./electron/database/init');

  // Keep string UUIDs as strings (do not coerce to binary Buffer)
  function uuidToBin(uuid) {
    return uuid;
  }

  // Coerce binary Buffer/Uint8Array to string UUID
  function binToUuid(bin) {
    if (!bin) return null;
    if (typeof bin === 'string') return bin;
    let hex = '';
    if (bin instanceof Uint8Array || Array.isArray(bin) || Buffer.isBuffer(bin)) {
      hex = Array.from(bin).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      return bin;
    }
    if (hex.length !== 32) return bin;
    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20, 32)
    ].join('-');
  }

  const initialization = (async () => {
    await initDatabase();
    return getDatabase();
  })();

  // Track active transaction state for SQLite
  let inTransaction = false;

  const translateQuery = (sql, params = []) => {
    let translatedSql = sql;
    const generatedValues = [];

    // Parse BIN_TO_UUID columns in SELECT clause to convert them in response
    const binToUuidColumns = [];
    const binToUuidPattern = /BIN_TO_UUID\(\s*([a-zA-Z0-9_.`\s]+?)\s*\)(?:\s+AS\s+([a-zA-Z0-9_`]+))?/gi;
    let colMatch;
    while ((colMatch = binToUuidPattern.exec(sql)) !== null) {
      const colName = colMatch[2] ? colMatch[2].replace(/[`]/g, '') : colMatch[1].split('.').pop().replace(/[`]/g, '').trim();
      binToUuidColumns.push(colName);
    }

    translatedSql = translatedSql.replace(/UUID_TO_BIN\(\s*UUID\(\)\s*\)/gi, () => {
      generatedValues.push(crypto.randomUUID());
      return '__SQLITE_UUID__';
    });

    translatedSql = translatedSql.replace(/UUID_TO_BIN\(\s*\?\s*\)/gi, '__UUID_TO_BIN_PARAM__');
    translatedSql = translatedSql.replace(/UUID_TO_BIN\(\s*([A-Za-z0-9_.`]+)\s*\)/gi, '$1');
    translatedSql = translatedSql.replace(/BIN_TO_UUID\(\s*([^)]+?)\s*\)/gi, '$1');

    // DATEDIFF handling with CURDATE() or other functions (must run before CURDATE() is translated to date('now'))
    translatedSql = translatedSql.replace(/DATEDIFF\(\s*([^,]+?)\s*,\s*CURDATE\(\)\s*\)/gi, "CAST((julianday($1) - julianday(date('now', 'localtime'))) AS INTEGER)");
    translatedSql = translatedSql.replace(/DATEDIFF\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/gi, "CAST((julianday($1) - julianday($2)) AS INTEGER)");

    // MySQL FORMAT(number, decimals) -> SQLite has no equivalent; ROUND() is a close approximation
    translatedSql = translatedSql.replace(/\bFORMAT\(\s*([^,]+?)\s*,\s*(\d+)\s*\)/gi, "ROUND($1, $2)");

    // MySQL JSON aggregation -> SQLite JSON1 equivalents (supported by sql.js)
    translatedSql = translatedSql.replace(/\bJSON_ARRAYAGG\s*\(/gi, 'json_group_array(');
    translatedSql = translatedSql.replace(/\bJSON_OBJECT\s*\(/gi, 'json_object(');

    translatedSql = translatedSql.replace(/DATE_FORMAT\(\s*([^)]+?)\s*,\s*['"]%Y-%m['"]\s*\)/gi, "strftime('%Y-%m', $1)");
    translatedSql = translatedSql.replace(/DATE_FORMAT\(\s*([^)]+?)\s*,\s*['"]%Y-%m-%d['"]\s*\)/gi, "strftime('%Y-%m-%d', $1)");
    // General DATE_ADD and DATE_SUB replacements.
    // 'localtime' matches MySQL semantics: NOW()/CURDATE() return the server's
    // local time, whereas bare SQLite date('now')/CURRENT_TIMESTAMP are UTC.
    translatedSql = translatedSql.replace(/DATE_ADD\(\s*(CURDATE\(\)|NOW\(\))\s*,\s*INTERVAL\s*(\d+)\s*DAY\s*\)/gi, "date('now', 'localtime', '+$2 day')");
    translatedSql = translatedSql.replace(/DATE_ADD\(\s*(CURDATE\(\)|NOW\(\))\s*,\s*INTERVAL\s*(\?)\s*DAY\s*\)/gi, "date('now', 'localtime', '+' || $2 || ' day')");
    translatedSql = translatedSql.replace(/DATE_SUB\(\s*(CURDATE\(\)|NOW\(\))\s*,\s*INTERVAL\s*(\d+)\s*DAY\s*\)/gi, "date('now', 'localtime', '-$2 day')");
    translatedSql = translatedSql.replace(/DATE_SUB\(\s*(CURDATE\(\)|NOW\(\))\s*,\s*INTERVAL\s*(\?)\s*DAY\s*\)/gi, "date('now', 'localtime', '-' || $2 || ' day')");

    // Interval subtract syntax (e.g. CURDATE() - INTERVAL 6 DAY)
    translatedSql = translatedSql.replace(/(CURDATE\(\)|NOW\(\))\s*-\s*INTERVAL\s*(\d+)\s*DAY/gi, "date('now', 'localtime', '-$2 day')");
    translatedSql = translatedSql.replace(/(CURDATE\(\)|NOW\(\))\s*-\s*INTERVAL\s*(\?)\s*DAY/gi, "date('now', 'localtime', '-' || $2 || ' day')");

    // Standard date function translation
    translatedSql = translatedSql.replace(/CURDATE\(\)/gi, "date('now', 'localtime')");
    translatedSql = translatedSql.replace(/CURRENT_DATE\(\)/gi, "date('now', 'localtime')");
    translatedSql = translatedSql.replace(/NOW\(\)/gi, "datetime('now', 'localtime')");
    translatedSql = translatedSql.replace(/CURRENT_TIMESTAMP\(\)/gi, "datetime('now', 'localtime')");
    // Bare CURRENT_TIMESTAMP in DML (e.g. SET updated_at = CURRENT_TIMESTAMP) is UTC
    // in SQLite; DDL never passes through this translator so DEFAULT clauses are safe.
    translatedSql = translatedSql.replace(/\bCURRENT_TIMESTAMP\b(?!\s*\()/gi, "datetime('now', 'localtime')");
    translatedSql = translatedSql.replace(/\bYEARWEEK\(\s*([^)]+?)\s*,\s*1\s*\)/gi, "strftime('%Y%W', $1)");
    translatedSql = translatedSql.replace(/\bDATE\(\s*([^)]+?)\s*\)/gi, 'date($1)');
    translatedSql = translatedSql.replace(/\bYEAR\(\s*([^)]+?)\s*\)/gi, "strftime('%Y', $1)");
    translatedSql = translatedSql.replace(/\bMONTH\(\s*([^)]+?)\s*\)/gi, "strftime('%m', $1)");
    translatedSql = translatedSql.replace(/\bDAY\(\s*([^)]+?)\s*\)/gi, "strftime('%d', $1)");

    // Transaction translations for SQLite compatibility
    // MySQL: START TRANSACTION -> SQLite: BEGIN
    translatedSql = translatedSql.replace(/\bSTART\s+TRANSACTION\b/gi, 'BEGIN');
    // MySQL: COMMIT [TRANSACTION] -> SQLite: COMMIT
    translatedSql = translatedSql.replace(/\bCOMMIT\s+TRANSACTION\b/gi, 'COMMIT');
    // MySQL: ROLLBACK [TRANSACTION] -> SQLite: ROLLBACK
    translatedSql = translatedSql.replace(/\bROLLBACK\s+TRANSACTION\b/gi, 'ROLLBACK');

    translatedSql = translatedSql.replace(/\bUUID\(\)/gi, "lower(hex(randomblob(16)))");

    const paramsQueue = Array.isArray(params) ? [...params] : [params];
    const finalParams = [];
    const placeholderPattern = /__SQLITE_UUID__|__UUID_TO_BIN_PARAM__|\?/g;
    let match;

    // sql.js only binds Number/String/Uint8Array/null — a raw JS Date or boolean
    // (both fine for mysql2, which serializes them itself) throws "tried to bind
    // a value of an unknown type" here. Normalize to what sql.js accepts.
    const normalizeSqliteParam = (value) => {
      if (value instanceof Date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
      }
      if (typeof value === 'boolean') {
        return value ? 1 : 0;
      }
      return value;
    };

    while ((match = placeholderPattern.exec(translatedSql)) !== null) {
      if (match[0] === '__SQLITE_UUID__') {
        finalParams.push(uuidToBin(generatedValues.shift() || crypto.randomUUID()));
      } else if (match[0] === '__UUID_TO_BIN_PARAM__') {
        finalParams.push(uuidToBin(paramsQueue.shift()));
      } else {
        finalParams.push(normalizeSqliteParam(paramsQueue.shift()));
      }
    }

    translatedSql = translatedSql.replace(/__SQLITE_UUID__|__UUID_TO_BIN_PARAM__/g, '?');

    return { sql: translatedSql, params: finalParams, binToUuidColumns };
  };

  const runStatement = (sql, params = []) => {
    const { sql: translatedSql, params: translatedParams, binToUuidColumns } = translateQuery(sql, params);
    return initialization.then(async (database) => {
      const isSelect = /^\s*(select|pragma|with)\b/i.test(translatedSql);

      if (isSelect) {
        let statement;
        try {
          statement = database.prepare(translatedSql);
          const rows = statement.all(translatedParams);
          if (rows && rows.length > 0) {
            for (const row of rows) {
              for (const key of Object.keys(row)) {
                const val = row[key];
                if (binToUuidColumns.includes(key) || (val instanceof Uint8Array && val.length === 16)) {
                  row[key] = binToUuid(val);
                }
              }
            }
          }
          return [rows];
        } catch (e) {
          console.error('--- db.js SELECT ERROR:', e.message);
          console.error('SQL query:', sql);
          console.error('Translated SQL:', translatedSql);
          console.error('Parameters:', translatedParams);
          throw e;
        } finally {
          if (statement && statement.free) {
            statement.free();
          }
        }
      }

      const isBegin = /^\s*BEGIN\b/i.test(translatedSql);
      const isCommit = /^\s*COMMIT\b/i.test(translatedSql);
      const isRollback = /^\s*ROLLBACK\b/i.test(translatedSql);

      // Guard: skip COMMIT/ROLLBACK when no transaction is active (avoids crash)
      if ((isCommit || isRollback) && !inTransaction) {
        console.log(`[db.js] Skipping ${isCommit ? 'COMMIT' : 'ROLLBACK'} — no active transaction`);
        return [{ affectedRows: 0, changedRows: 0, insertId: 0 }];
      }

      try {
        database.run(translatedSql, translatedParams);
        // Update transaction tracking
        if (isBegin) { inTransaction = true; }
        if (isCommit || isRollback) { inTransaction = false; }
      } catch (e) {
        if (isBegin || isCommit || isRollback) { inTransaction = false; }
        // Silently ignore "no transaction is active" for ROLLBACK/COMMIT —
        // this happens when BEGIN ran on a different pool instance or failed silently.
        if ((isRollback || isCommit) && e.message && e.message.includes('no transaction')) {
          console.warn(`[db.js] Ignoring ${isRollback ? 'ROLLBACK' : 'COMMIT'} — no active transaction (safe to ignore)`);
        } else {
          console.error('--- db.js EXECUTE ERROR:', e.message);
          console.error('SQL query:', sql);
          console.error('Translated SQL:', translatedSql);
          console.error('Parameters:', translatedParams);
          throw e;
        }
      }
      const rowsModified = typeof database.getRowsModified === 'function' ? database.getRowsModified() : 0;
      const lastInsertResult = database.exec('SELECT last_insert_rowid() AS id');
      const insertId = lastInsertResult?.[0]?.values?.[0]?.[0] || 0;

      // Only persist when NOT inside a transaction (after COMMIT, or regular auto-commit DML).
      // Writing the database file mid-transaction resets sql.js in-memory state,
      // causing the next ROLLBACK/COMMIT to fail with "no transaction is active".
      if (!inTransaction) {
        await persistDatabase();
      }

      return [{
        affectedRows: rowsModified,
        changedRows: rowsModified,
        insertId
      }];
    });
  };

  return {
    async execute(sql, params = []) {
      return runStatement(sql, params);
    },
    async query(sql, params = []) {
      return runStatement(sql, params);
    },
    promise() {
      return this;
    },
    async getConnection() {
      return {
        execute: this.execute.bind(this),
        query: this.query.bind(this),
        async beginTransaction() {
          return runStatement('BEGIN');
        },
        async commit() {
          return runStatement('COMMIT');
        },
        async rollback() {
          return runStatement('ROLLBACK');
        },
        release() { }
      };
    },
    async end() {
      await initialization;
      return undefined;
    }
  };
}

let pool;

if (useSqlite) {
  pool = createSqlitePool();
  console.log('Connected to local SQLite database for desktop mode');
} else {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'manage_hub',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000
  };

  const mysqlPool = mysql.createPool(dbConfig);
  let activePool = mysqlPool;
  let poolMode = 'mysql';

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // MySQL (e.g. XAMPP) may still be starting up when this process boots, so retry
  // a few times before giving up — a single instant failure shouldn't permanently
  // strand the app on the SQLite fallback for its entire lifetime.
  async function connectWithRetry(attempts = 5, delayMs = 2000) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const conn = await mysqlPool.getConnection();
        conn.release();
        console.log('Connected to MySQL!');
        return mysqlPool;
      } catch (err) {
        console.error(`MySQL connection attempt ${attempt}/${attempts} failed:`, err.message);
        if (attempt < attempts) await sleep(delayMs);
      }
    }

    console.log('Falling back to local SQLite database...');
    activePool = createSqlitePool();
    poolMode = 'sqlite';
    console.log('Connected to local SQLite database for fallback mode');

    // Keep checking in the background so the app recovers automatically once
    // MySQL becomes reachable, instead of staying on the fallback until restarted.
    const recoveryInterval = setInterval(async () => {
      try {
        const conn = await mysqlPool.getConnection();
        conn.release();
        activePool = mysqlPool;
        poolMode = 'mysql';
        console.log('MySQL is back online — switched off the SQLite fallback.');
        clearInterval(recoveryInterval);
      } catch (_) {
        // still down, keep waiting
      }
    }, 15000);

    return activePool;
  }

  let initialization = connectWithRetry();

  pool = {
    async execute(sql, params = []) {
      const resolvedPool = await initialization;
      return resolvedPool.execute(sql, params);
    },
    async query(sql, params = []) {
      const resolvedPool = await initialization;
      return resolvedPool.query(sql, params);
    },
    promise() {
      return this;
    },
    async getConnection() {
      const resolvedPool = await initialization;
      if (resolvedPool.getConnection) {
        return resolvedPool.getConnection();
      }

      return {
        execute: resolvedPool.execute.bind(resolvedPool),
        query: resolvedPool.query.bind(resolvedPool),
        release() { }
      };
    },
    async end() {
      const resolvedPool = await initialization;
      if (resolvedPool.end) {
        return resolvedPool.end();
      }
      return undefined;
    },
    get mode() {
      return poolMode;
    }
  };
}

module.exports = { pool };



