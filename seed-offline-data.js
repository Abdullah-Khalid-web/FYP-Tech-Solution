require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

process.env.DB_MODE = 'sqlite';
process.env.ELECTRON_START = '1';

// Delete the existing database files to clean up old binary schemas
const appDataDbPath = 'C:\\Users\\nassa\\AppData\\Roaming\\Electron\\managehub.db';
const localDbPath = path.join(__dirname, 'data', 'managehub.db');

for (const p of [appDataDbPath, localDbPath]) {
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
      console.log(`🗑️ Deleted existing database: ${p}`);
    } catch (e) {
      console.warn(`⚠️ Warning: Could not delete ${p}: ${e.message}`);
    }
  }
}

// Override init.js path resolving to point stand-alone script to AppData database if requested
const initPath = './electron/database/init';
const { initDatabase, getDatabase, persistDatabase } = require(initPath);

// Helper to execute INSERT statements
function insert(db, sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {}
  stmt.free();
}

async function seedDatabase() {
  try {
    console.log('\n🌱 Starting offline database seeding...\n');

    await initDatabase();
    const db = await getDatabase();

    // Define standard string UUIDs
    const shopId = '12345678-1234-1234-1234-123456789abc';
    const ownerRoleId = '23456789-2345-2345-2345-234567890abc';
    const adminRoleId = '23456789-2345-2345-2345-234567890def';
    const staffRoleId = '23456789-2345-2345-2345-234567890ghi';

    // Insert Shop
    console.log('📦 Inserting test shop...');
    insert(db, `
      INSERT INTO shops (id, name, email, phone, address, logo, plan, currency, primary_color, secondary_color, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [shopId, 'Bytes Breaker Store', 'bytesbreaker.dev@gmail.com', '+92-300-0000000', 'Test Address, Quetta', null, 'premium', 'PKR', '#3498db', '#2ecc71', 'active', new Date().toISOString(), new Date().toISOString()]);
    console.log('✅ Shop inserted');

    // Insert Roles
    console.log('👤 Inserting roles...');
    insert(db, `INSERT INTO roles (id, role_name, description, status, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [ownerRoleId, 'owner', 'Owner role', 'active', new Date().toISOString()]);
    insert(db, `INSERT INTO roles (id, role_name, description, status, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [adminRoleId, 'Admin', 'Administrator role', 'active', new Date().toISOString()]);
    insert(db, `INSERT INTO roles (id, role_name, description, status, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [staffRoleId, 'Staff', 'Staff role', 'active', new Date().toISOString()]);
    console.log('✅ Roles created');

    // Insert Users
    console.log('👥 Inserting test users...');
    const ownerId = '34567890-3456-3456-3456-345678903456';
    const staffId = '34567890-3456-3456-3456-345678907890';
    const hashedOwnerPwd = bcrypt.hashSync('123456', 10);
    const hashedPwd = bcrypt.hashSync('password123', 10);

    // Custom owner account
    insert(db, `INSERT INTO users (id, shop_id, role_id, name, email, password, phone, salary, loan, cnic, status, created_at, updated_at, notes, profile_picture) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ownerId, shopId, ownerRoleId, 'Bytes Breaker', 'bytesbreaker.dev@gmail.com', hashedOwnerPwd, '+92-300-0000000', 100000, 0, '12345-6789012-3', 'active', new Date().toISOString(), new Date().toISOString(), 'Store Owner', null]);

    // Staff account
    insert(db, `INSERT INTO users (id, shop_id, role_id, name, email, password, phone, salary, loan, cnic, status, created_at, updated_at, notes, profile_picture) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [staffId, shopId, staffRoleId, 'Staff User', 'staff@managehub.com', hashedPwd, '+92-300-7654321', 25000, 0, '98765-4321098-7', 'active', new Date().toISOString(), new Date().toISOString(), 'Test staff user', null]);
    console.log('✅ Users inserted');

    // Insert Products
    console.log('📦 Inserting test products...');
    const products = [
      {id: '56789012-5678-5678-5678-567890123456', name: 'MilkyBar Chocolate', brand: 'Cadbury', category: 'Confectionery', size: '45g', sku: 'MILK-001', barcode: '1234567890123'},
      {id: '56789012-5678-5678-5678-567890123457', name: 'Sprite Bottle', brand: 'Coca-Cola', category: 'Beverages', size: '500ml', sku: 'SPRITE-001', barcode: '9876543210987'},
      {id: '56789012-5678-5678-5678-567890123458', name: 'Wheat Flour', brand: 'Local Mill', category: 'Dry Goods', size: '10kg', sku: 'FLOUR-001', barcode: '5555555555555'}
    ];

    for (const p of products) {
      insert(db, `INSERT INTO products (id, shop_id, name, brand, category, size, sku, barcode, active, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, shopId, p.name, p.brand, p.category, p.size, p.sku, p.barcode, 1, new Date().toISOString(), new Date().toISOString(), 'active']);
    }
    console.log('✅ Products inserted');

    // Insert Inventory
    console.log('📊 Inserting inventory records...');
    for (const p of products) {
      insert(db, `INSERT INTO inventory (id, shop_id, product_id, current_quantity, avg_cost, selling_price, last_buying_price, min_stock_level, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), shopId, p.id, 100, 50, 150, 50, 10, new Date().toISOString()]);
    }
    console.log('✅ Inventory created');

    // Insert Raw Materials
    console.log('🌾 Inserting raw materials...');
    insert(db, `INSERT INTO raw_materials (id, shop_id, name, sku, barcode, category, description, unit_of_measure, current_stock, min_stock_level, max_stock_level, cost_price, batch_tracking, expiry_tracking, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), shopId, 'Sugar', 'RAW-SUGAR-001', '1111111111111', 'Sweeteners', 'Granulated sugar', 'kg', 500, 50, 1000, 100, 1, 0, 1, 'bytesbreaker.dev@gmail.com', new Date().toISOString(), new Date().toISOString()]);
    
    insert(db, `INSERT INTO raw_materials (id, shop_id, name, sku, barcode, category, description, unit_of_measure, current_stock, min_stock_level, max_stock_level, cost_price, batch_tracking, expiry_tracking, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), shopId, 'Milk Powder', 'RAW-MILK-001', '2222222222222', 'Dairy', 'Instant milk powder', 'kg', 200, 30, 500, 250, 1, 1, 1, 'bytesbreaker.dev@gmail.com', new Date().toISOString(), new Date().toISOString()]);
    console.log('✅ Raw materials inserted');

    // Insert Supplier
    console.log('🏢 Inserting supplier...');
    insert(db, `INSERT INTO suppliers (id, shop_id, name, contact_person, email, phone, address, tax_number, payment_terms, type, status, created_at, updated_at, account_number, bank_name, notes, city, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), shopId, 'Test Supplier Co.', 'John Supplier', 'supplier@test.com', '+92-300-5555555', '123 Supply St', 'TAX-12345', 'Net 30', 'wholesale', 'active', new Date().toISOString(), new Date().toISOString(), '12345678', 'Bank Name', 'Test supplier', 'Quetta', 'Pakistan']);
    console.log('✅ Supplier inserted');

    // Insert Subscription
    console.log('💳 Inserting subscription...');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    insert(db, `INSERT INTO subscriptions (id, shop_id, plan_name, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), shopId, 'premium', 'active', expiresAt.toISOString(), new Date().toISOString(), new Date().toISOString()]);
    console.log('✅ Subscription created');

    // Persist database
    await persistDatabase();
    
    // Copy the database file to AppData if we are running standalone to make sure Electron picks it up immediately
    if (fs.existsSync(localDbPath)) {
      const appDataDir = path.dirname(appDataDbPath);
      if (!fs.existsSync(appDataDir)) {
        fs.mkdirSync(appDataDir, { recursive: true });
      }
      fs.copyFileSync(localDbPath, appDataDbPath);
      console.log(`💾 Copied database to AppData: ${appDataDbPath}`);
    }

    console.log('\n✅ Database seeding completed successfully!\n');
    console.log('📝 Credentials:');
    console.log('   Email: bytesbreaker.dev@gmail.com');
    console.log('   Password: 123456\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();
