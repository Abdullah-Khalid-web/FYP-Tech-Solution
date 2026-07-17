const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
let electronApp = null;

try {
    electronApp = require('electron').app;
} catch (error) {
    electronApp = null;
}

// Get user data path
const userDataPath = electronApp ? electronApp.getPath('userData') : path.join(process.cwd(), 'data');
const dbPath = path.join(userDataPath, 'managehub.db');

console.log('📁 Database path:', dbPath);

// Ensure directory exists
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

let SQL = null;
let db = null;
let sqlLoadPromise = null;

async function getSqlJs() {
    if (SQL) {
        return SQL;
    }

    if (!sqlLoadPromise) {
        sqlLoadPromise = initSqlJs({
            locateFile: (file) => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
        }).then((module) => {
            SQL = module;
            return module;
        });
    }

    return sqlLoadPromise;
}

async function getDatabase() {
    if (db) {
        return db;
    }

    console.log('--- Instantiating new SQL.js Database instance...');

    const SQLModule = await getSqlJs();

    if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
        db = new SQLModule.Database(fs.readFileSync(dbPath));
    } else {
        db = new SQLModule.Database();
    }

    db.pragma = (statement) => {
        db.exec(`PRAGMA ${statement}`);
    };

    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
        const statement = originalPrepare(sql);
        statement.all = (params = []) => {
            statement.bind(params);
            const rows = [];

            while (statement.step()) {
                rows.push(statement.getAsObject());
            }

            statement.free();
            return rows;
        };

        return statement;
    };

    // Add run method if it doesn't exist
    if (!db.run) {
        db.run = (sql, params = []) => {
            const stmt = db.prepare(sql);
            stmt.bind(params);
            stmt.step();
            stmt.free();
            return this;
        };
    }
    
    db.exec = db.exec.bind(db);

    db.pragma('foreign_keys = ON');

    return db;
}

async function persistDatabase() {
    if (!db) {
        return;
    }

    fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function ensureColumn(tableName, columnName, columnDefinition) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = columns.some((column) => column.name === columnName);

    if (!exists) {
        const alterDefinition = columnDefinition.replace(/\s+DEFAULT\s+CURRENT_TIMESTAMP/i, '');
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${alterDefinition}`);
    }
}

function createSyncTriggersForTable(db, tableName, columns) {
    db.exec(`DROP TRIGGER IF EXISTS trg_${tableName}_sync_insert;`);
    db.exec(`DROP TRIGGER IF EXISTS trg_${tableName}_sync_update;`);
    db.exec(`DROP TRIGGER IF EXISTS trg_${tableName}_sync_delete;`);

    const insertJsonArgs = columns.map(col => `'${col}', new.${col}`).join(', ');
    const insertTriggerSql = `
        CREATE TRIGGER trg_${tableName}_sync_insert
        AFTER INSERT ON ${tableName}
        FOR EACH ROW
        BEGIN
            INSERT INTO sync_queue (table_name, record_id, action, payload)
            VALUES ('${tableName}', new.id, 'insert', json_object(${insertJsonArgs}));
        END;
    `;

    const updateJsonArgs = columns.map(col => `'${col}', new.${col}`).join(', ');
    const updateTriggerSql = `
        CREATE TRIGGER trg_${tableName}_sync_update
        AFTER UPDATE ON ${tableName}
        FOR EACH ROW
        BEGIN
            INSERT INTO sync_queue (table_name, record_id, action, payload)
            VALUES ('${tableName}', new.id, 'update', json_object(${updateJsonArgs}));
        END;
    `;

    const deleteTriggerSql = `
        CREATE TRIGGER trg_${tableName}_sync_delete
        AFTER DELETE ON ${tableName}
        FOR EACH ROW
        BEGIN
            INSERT INTO sync_queue (table_name, record_id, action, payload)
            VALUES ('${tableName}', old.id, 'delete', '{}');
        END;
    `;

    db.exec(insertTriggerSql);
    db.exec(updateTriggerSql);
    db.exec(deleteTriggerSql);
}

async function initDatabase() {
    await getDatabase();
    console.log('🔄 Initializing database tables...');

    // ===== USERS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            role_id TEXT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT,
            phone TEXT,
            salary REAL,
            loan REAL,
            cnic TEXT,
            status TEXT DEFAULT 'active',
            profile_picture TEXT,
            notes TEXT,
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            sync_error TEXT,
            last_sync_attempt DATETIME
        )
    `);

    // ===== ROLES TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS roles (
            id TEXT PRIMARY KEY,
            role_name TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'active',
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced'
        )
    `);

    // ===== SHOPS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS shops (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            address TEXT,
            logo TEXT,
            plan TEXT DEFAULT 'free',
            currency TEXT DEFAULT 'PKR',
            primary_color TEXT DEFAULT '#007bff',
            secondary_color TEXT DEFAULT '#6c757d',
            status TEXT DEFAULT 'active',
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced'
        )
    `);

    // ===== PRODUCTS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            name TEXT NOT NULL,
            brand TEXT,
            category TEXT,
            size TEXT,
            sku TEXT UNIQUE,
            barcode TEXT,
            active TEXT DEFAULT 'yes',
            status TEXT DEFAULT 'active',
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            sync_error TEXT,
            last_sync_attempt DATETIME,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
        )
    `);

    // ===== EMPLOYEES (uses users table) =====
    // We'll use the users table for employees

    // ===== EXPENSES TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS expenses (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            expense_date TEXT NOT NULL,
            payment_method TEXT DEFAULT 'cash',
            receipt_number TEXT,
            created_by TEXT,
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            sync_error TEXT,
            last_sync_attempt DATETIME,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // ===== SUPPLIERS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS suppliers (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            name TEXT NOT NULL,
            contact_person TEXT,
            email TEXT,
            phone TEXT,
            address TEXT,
            tax_number TEXT,
            payment_terms TEXT,
            type TEXT DEFAULT 'both',
            status TEXT DEFAULT 'active',
            account_number TEXT,
            bank_name TEXT,
            notes TEXT,
            city TEXT,
            country TEXT,
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            sync_error TEXT,
            last_sync_attempt DATETIME,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
        )
    `);

    // ===== CASH SUBMISSIONS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_cash_submission (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            user_id TEXT,
            submission_date TEXT NOT NULL,
            total_collected REAL NOT NULL,
            submitted_amount REAL NOT NULL,
            difference REAL,
            status TEXT DEFAULT 'pending',
            verified_by TEXT,
            verified_at TEXT,
            rejection_reason TEXT,
            notes TEXT,
            shift TEXT DEFAULT 'morning',
            payment_method TEXT DEFAULT 'cash',
            reference_number TEXT,
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            sync_error TEXT,
            last_sync_attempt DATETIME,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // ===== BILLS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS bills (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            bill_number TEXT UNIQUE NOT NULL,
            customer_id TEXT,
            customer_name TEXT,
            customer_phone TEXT,
            subtotal REAL NOT NULL,
            discount REAL DEFAULT 0,
            tax REAL DEFAULT 0,
            total_amount REAL NOT NULL,
            paid_amount REAL NOT NULL,
            due_amount REAL DEFAULT 0,
            payment_method TEXT,
            notes TEXT,
            created_by TEXT,
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            sync_error TEXT,
            last_sync_attempt DATETIME,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // ===== BILL ITEMS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS bill_items (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            product_id TEXT,
            bill_id TEXT,
            batch_number TEXT,
            quantity REAL NOT NULL,
            unit_price REAL NOT NULL,
            total_price REAL NOT NULL,
            sold_by TEXT,
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
            FOREIGN KEY (sold_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // ===== CUSTOMERS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            address TEXT,
            type TEXT DEFAULT 'regular',
            city TEXT,
            country TEXT DEFAULT 'Pakistan',
            notes TEXT,
            reference TEXT,
            discount REAL DEFAULT 0,
            credit_limit REAL DEFAULT 0,
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
        )
    `);

    // ===== INVENTORY TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS inventory (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            product_id TEXT,
            current_quantity REAL DEFAULT 0,
            avg_cost REAL DEFAULT 0,
            selling_price REAL DEFAULT 0,
            last_buying_price REAL DEFAULT 0,
            min_stock_level REAL DEFAULT 10,
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            UNIQUE(shop_id, product_id)
        )
    `);

    // ===== STOCK IN TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS stock_in (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            product_id TEXT,
            batch_number TEXT,
            quantity REAL NOT NULL,
            unit_price REAL NOT NULL,
            buying_price REAL DEFAULT 0,
            selling_price REAL DEFAULT 0,
            total_buying_value REAL DEFAULT 0,
            expiry_date TEXT,
            supplier_id TEXT,
            transaction_type TEXT DEFAULT 'credit',
            payment_amount REAL DEFAULT 0,
            notes TEXT,
            received_by TEXT,
            uuid TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
            FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // ===== RAW MATERIALS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS raw_materials (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            name TEXT NOT NULL,
            sku TEXT,
            barcode TEXT,
            category TEXT,
            description TEXT,
            unit_of_measure TEXT NOT NULL,
            current_stock REAL DEFAULT 0,
            min_stock_level REAL DEFAULT 0,
            max_stock_level REAL DEFAULT 0,
            cost_price REAL DEFAULT 0,
            supplier_id TEXT,
            batch_tracking INTEGER DEFAULT 0,
            expiry_tracking INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_by TEXT,
            uuid TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            sync_error TEXT,
            last_sync_attempt DATETIME,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // ===== RAW MATERIAL STOCK MOVEMENTS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS raw_material_stock_movements (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            raw_material_id TEXT NOT NULL,
            batch_number TEXT,
            movement_type TEXT NOT NULL,
            quantity REAL NOT NULL,
            unit_cost REAL DEFAULT 0,
            total_cost REAL DEFAULT 0,
            reference_type TEXT,
            reference_id TEXT,
            supplier_id TEXT,
            notes TEXT,
            movement_date TEXT DEFAULT CURRENT_TIMESTAMP,
            expiry_date TEXT,
            created_by TEXT,
            uuid TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'synced',
            sync_error TEXT,
            last_sync_attempt DATETIME,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE CASCADE,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // ===== INGREDIENTS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS ingredients (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            main_product_id TEXT NOT NULL,
            raw_material_id TEXT NOT NULL,
            quantity_required REAL NOT NULL,
            unit TEXT,
            uuid TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (main_product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE CASCADE
        )
    `);

    // ===== SUPPLIER TRANSACTIONS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS supplier_transactions (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            supplier_id TEXT NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            description TEXT,
            reference_type TEXT,
            reference_id TEXT,
            created_by TEXT,
            transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            uuid TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
        )
    `);

    // ===== SUPPLIER BALANCE TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS supplier_balance (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            supplier_id TEXT NOT NULL,
            total_debit REAL DEFAULT 0,
            total_credit REAL DEFAULT 0,
            balance REAL DEFAULT 0,
            uuid TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
            UNIQUE(shop_id, supplier_id)
        )
    `);

    // ===== SYNC QUEUE TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            record_id TEXT NOT NULL,
            action TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ===== SYNC METADATA TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS sync_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            last_synced_at DATETIME,
            last_sync_status TEXT,
            last_sync_count INTEGER DEFAULT 0,
            UNIQUE(table_name)
        )
    `);

    // ===== AUTH + ADMIN TABLES =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS password_resets (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            used INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            used_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS permissions (
            id TEXT PRIMARY KEY,
            slug TEXT NOT NULL UNIQUE,
            name TEXT,
            module TEXT,
            description TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS role_permissions (
            role_id TEXT NOT NULL,
            permission_id TEXT NOT NULL,
            PRIMARY KEY (role_id, permission_id)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS user_permissions (
            user_id TEXT NOT NULL,
            permission_id TEXT NOT NULL,
            PRIMARY KEY (user_id, permission_id)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS pricing_plans (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            monthly_price REAL DEFAULT 0,
            quarterly_price REAL DEFAULT 0,
            yearly_price REAL DEFAULT 0,
            features TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id TEXT PRIMARY KEY,
            shop_id TEXT NOT NULL,
            plan_name TEXT NOT NULL,
            price REAL,
            duration TEXT,
            started_at DATETIME,
            status TEXT DEFAULT 'active',
            expires_at DATETIME,
            payment_method TEXT,
            payment_details TEXT,
            auto_renew INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS feedback (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            user_id TEXT,
            subject TEXT,
            message TEXT,
            rating REAL,
            status TEXT DEFAULT 'new',
            admin_notes TEXT,
            admin_reply TEXT,
            replied_by TEXT,
            replied_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ===== ADMIN ACTIONS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS admin_actions (
            id TEXT PRIMARY KEY,
            admin_id TEXT,
            shop_id TEXT,
            action_type TEXT,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ===== BACKUPS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS backups (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            filename TEXT,
            file_path TEXT,
            file_size INTEGER,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ===== CASH REGISTER TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS cash_register (
            id TEXT PRIMARY KEY,
            shop_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            shift_start DATETIME NOT NULL,
            shift_end DATETIME DEFAULT NULL,
            opening_balance REAL NOT NULL,
            closing_balance REAL DEFAULT 0.00,
            expected_balance REAL DEFAULT 0.00,
            difference REAL DEFAULT 0.00,
            status TEXT DEFAULT 'open',
            notes TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // ===== PAYMENT TRANSACTIONS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS payment_transactions (
            id TEXT PRIMARY KEY,
            shop_id TEXT NOT NULL,
            stripe_session_id TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            status TEXT NOT NULL,
            payment_method TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
        )
    `);

    // ===== USER LOAN TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_loan (
            id TEXT PRIMARY KEY,
            shop_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            loan_number TEXT NOT NULL UNIQUE,
            loan_type TEXT DEFAULT 'full',
            total_amount REAL NOT NULL,
            total_paid REAL DEFAULT 0,
            total_balance REAL,
            installments INTEGER DEFAULT 1,
            installment_amount REAL,
            description TEXT,
            loan_date TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            created_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // ===== USER LOAN LEDGER TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_loan_ledger (
            id TEXT PRIMARY KEY,
            loan_id TEXT NOT NULL,
            shop_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            transaction_type TEXT NOT NULL,
            amount REAL NOT NULL,
            description TEXT,
            payment_method TEXT DEFAULT 'cash',
            reference_id TEXT,
            reference_type TEXT DEFAULT 'direct_payment',
            created_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (loan_id) REFERENCES user_loan(id) ON DELETE CASCADE,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // ===== USER SALARY TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_salary (
            id TEXT PRIMARY KEY,
            shop_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            amount REAL NOT NULL,
            bonus REAL DEFAULT 0,
            fine REAL DEFAULT 0,
            net_amount REAL,
            month TEXT NOT NULL,
            paid_on TEXT,
            status TEXT DEFAULT 'pending',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Note: user_loan.total_paid/status updates are handled explicitly in
    // empmgmtController.js (portable across MySQL and SQLite) rather than via a
    // SQLite-only trigger here, to avoid double-applying loan repayments.
    db.exec(`DROP TRIGGER IF EXISTS after_loan_ledger_insert;`);

    ensureColumn('users', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('roles', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('shops', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('products', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('expenses', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('suppliers', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('user_cash_submission', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('bills', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('bill_items', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('customers', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('inventory', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('stock_in', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('raw_materials', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('raw_materials', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('raw_material_stock_movements', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('raw_material_stock_movements', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('ingredients', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('ingredients', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('supplier_transactions', 'created_by', 'created_by TEXT');
    ensureColumn('supplier_transactions', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('supplier_transactions', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('supplier_balance', 'balance', 'balance REAL DEFAULT 0');
    ensureColumn('supplier_balance', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('supplier_balance', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('cash_register', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('payment_transactions', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('user_loan', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('user_loan', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('user_loan_ledger', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('user_salary', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('user_salary', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');

    // Bring older local databases up to date with columns/tables that were
    // added to the MySQL schema after the SQLite schema was first written.
    ensureColumn('subscriptions', 'price', 'price REAL');
    ensureColumn('subscriptions', 'duration', 'duration TEXT');
    ensureColumn('subscriptions', 'started_at', 'started_at DATETIME');
    ensureColumn('subscriptions', 'payment_method', 'payment_method TEXT');
    ensureColumn('subscriptions', 'payment_details', 'payment_details TEXT');
    ensureColumn('subscriptions', 'auto_renew', 'auto_renew INTEGER DEFAULT 0');
    ensureColumn('feedback', 'user_id', 'user_id TEXT');
    ensureColumn('feedback', 'admin_reply', 'admin_reply TEXT');
    ensureColumn('feedback', 'replied_by', 'replied_by TEXT');
    ensureColumn('feedback', 'replied_at', 'replied_at DATETIME');
    ensureColumn('feedback', 'show_on_website', 'show_on_website INTEGER DEFAULT 0');
    // role_permissions/user_permissions were originally created with only their composite-key
    // columns; the admin Roles & Permissions UI needs id/created_at to match the MySQL schema.
    ensureColumn('role_permissions', 'id', 'id TEXT');
    ensureColumn('role_permissions', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('user_permissions', 'id', 'id TEXT');
    ensureColumn('user_permissions', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');

    // ===== DYNAMIC SYNC TRIGGERS SETUP =====
    const SYNC_TRIGGERS_CONFIG = {
        users: ['id', 'shop_id', 'role_id', 'name', 'email', 'password', 'phone', 'salary', 'loan', 'cnic', 'status', 'created_at', 'updated_at', 'notes', 'profile_picture'],
        products: ['id', 'shop_id', 'name', 'brand', 'category', 'size', 'sku', 'barcode', 'active', 'created_at', 'updated_at'],
        inventory: ['id', 'shop_id', 'product_id', 'current_quantity', 'avg_cost', 'selling_price', 'last_buying_price', 'min_stock_level', 'updated_at'],
        stock_in: ['id', 'shop_id', 'product_id', 'batch_number', 'quantity', 'unit_price', 'buying_price', 'selling_price', 'total_buying_value', 'expiry_date', 'supplier_id', 'transaction_type', 'payment_amount', 'notes', 'received_by', 'created_at'],
        suppliers: ['id', 'shop_id', 'name', 'contact_person', 'email', 'phone', 'address', 'tax_number', 'payment_terms', 'type', 'status', 'account_number', 'bank_name', 'notes', 'city', 'country', 'created_at', 'updated_at'],
        customers: ['id', 'shop_id', 'name', 'phone', 'email', 'address', 'type', 'city', 'country', 'notes', 'reference', 'discount', 'credit_limit', 'created_at', 'updated_at'],
        bills: ['id', 'shop_id', 'bill_number', 'customer_id', 'customer_name', 'customer_phone', 'subtotal', 'discount', 'tax', 'total_amount', 'paid_amount', 'due_amount', 'payment_method', 'notes', 'created_by', 'created_at'],
        bill_items: ['id', 'shop_id', 'product_id', 'batch_number', 'quantity', 'unit_price', 'total_price', 'bill_id', 'sold_by', 'created_at'],
        expenses: ['id', 'shop_id', 'category', 'description', 'amount', 'expense_date', 'payment_method', 'receipt_number', 'created_by', 'created_at', 'updated_at'],
        user_cash_submission: ['id', 'shop_id', 'user_id', 'submission_date', 'total_collected', 'submitted_amount', 'notes', 'created_at', 'status', 'verified_by', 'verified_at', 'rejection_reason', 'shift', 'payment_method', 'reference_number'],
        user_loan: ['id', 'shop_id', 'user_id', 'loan_number', 'loan_type', 'total_amount', 'total_paid', 'installments', 'installment_amount', 'description', 'loan_date', 'status', 'created_by', 'created_at', 'updated_at'],
        user_loan_ledger: ['id', 'loan_id', 'shop_id', 'user_id', 'transaction_type', 'amount', 'description', 'payment_method', 'reference_id', 'reference_type', 'created_by', 'created_at'],
        user_salary: ['id', 'shop_id', 'user_id', 'amount', 'bonus', 'fine', 'month', 'paid_on', 'status', 'notes', 'created_at', 'updated_at'],
        cash_register: ['id', 'shop_id', 'user_id', 'shift_start', 'shift_end', 'opening_balance', 'closing_balance', 'expected_balance', 'difference', 'status', 'notes', 'created_at'],
        raw_materials: ['id', 'shop_id', 'name', 'sku', 'barcode', 'category', 'description', 'unit_of_measure', 'current_stock', 'min_stock_level', 'max_stock_level', 'cost_price', 'supplier_id', 'batch_tracking', 'expiry_tracking', 'is_active', 'created_by', 'created_at', 'updated_at'],
        raw_material_stock_movements: ['id', 'shop_id', 'raw_material_id', 'batch_number', 'movement_type', 'quantity', 'unit_cost', 'total_cost', 'reference_type', 'reference_id', 'supplier_id', 'notes', 'movement_date', 'expiry_date', 'created_by', 'created_at'],
        ingredients: ['id', 'shop_id', 'main_product_id', 'raw_material_id', 'quantity_required', 'unit', 'created_at'],
        supplier_transactions: ['id', 'shop_id', 'supplier_id', 'type', 'amount', 'description', 'reference_type', 'reference_id', 'created_by', 'created_at'],
        supplier_balance: ['id', 'shop_id', 'supplier_id', 'total_debit', 'total_credit']
    };

    db._syncTriggersConfig = SYNC_TRIGGERS_CONFIG;

    for (const [tableName, columns] of Object.entries(SYNC_TRIGGERS_CONFIG)) {
        createSyncTriggersForTable(db, tableName, columns);
    }

    // Create indexes for performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_shop ON users(shop_id);
        CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);
        CREATE INDEX IF NOT EXISTS idx_expenses_shop ON expenses(shop_id);
        CREATE INDEX IF NOT EXISTS idx_suppliers_shop ON suppliers(shop_id);
        CREATE INDEX IF NOT EXISTS idx_bills_shop ON bills(shop_id);
        CREATE INDEX IF NOT EXISTS idx_password_reset_email ON password_resets(email);
        CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_resets(token);
        CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_shop ON subscriptions(shop_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_shop ON feedback(shop_id);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name);
        CREATE INDEX IF NOT EXISTS idx_cash_register_shop ON cash_register(shop_id);
        CREATE INDEX IF NOT EXISTS idx_cash_register_user ON cash_register(user_id);
        CREATE INDEX IF NOT EXISTS idx_cash_register_status ON cash_register(status);
        CREATE INDEX IF NOT EXISTS idx_user_loan_shop ON user_loan(shop_id);
        CREATE INDEX IF NOT EXISTS idx_user_loan_user ON user_loan(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_loan_ledger_loan ON user_loan_ledger(loan_id);
        CREATE INDEX IF NOT EXISTS idx_user_loan_ledger_user ON user_loan_ledger(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_salary_shop ON user_salary(shop_id);
        CREATE INDEX IF NOT EXISTS idx_user_salary_user ON user_salary(user_id);
    `);

    console.log('✅ Database initialized successfully');
    await persistDatabase();
    return db;
}

function disableSyncTriggers(database) {
    const config = database._syncTriggersConfig || {};
    for (const tableName of Object.keys(config)) {
        database.exec(`DROP TRIGGER IF EXISTS trg_${tableName}_sync_insert;`);
        database.exec(`DROP TRIGGER IF EXISTS trg_${tableName}_sync_update;`);
        database.exec(`DROP TRIGGER IF EXISTS trg_${tableName}_sync_delete;`);
    }
}

function enableSyncTriggers(database) {
    const config = database._syncTriggersConfig || {};
    for (const [tableName, columns] of Object.entries(config)) {
        createSyncTriggersForTable(database, tableName, columns);
    }
}

module.exports = {
    initDatabase,
    getDatabase,
    persistDatabase,
    dbPath,
    disableSyncTriggers,
    enableSyncTriggers
};