const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Get user data path
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'managehub.db');

console.log('📁 Database path:', dbPath);

// Ensure directory exists
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

// Initialize database
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

function initDatabase() {
    console.log('🔄 Initializing database tables...');

    // ===== USERS TABLE =====
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            shop_id TEXT,
            role_id TEXT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
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

    // Create indexes for performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_shop ON users(shop_id);
        CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);
        CREATE INDEX IF NOT EXISTS idx_expenses_shop ON expenses(shop_id);
        CREATE INDEX IF NOT EXISTS idx_suppliers_shop ON suppliers(shop_id);
        CREATE INDEX IF NOT EXISTS idx_bills_shop ON bills(shop_id);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name);
    `);

    console.log('✅ Database initialized successfully');
    return db;
}

module.exports = { initDatabase, db, dbPath };