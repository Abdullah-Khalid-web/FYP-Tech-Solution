const { db } = require('../database/init');
const { v4: uuidv4 } = require('uuid');

class DatabaseService {
    constructor() {
        this.tables = {
            users: 'users',
            products: 'products',
            expenses: 'expenses',
            suppliers: 'suppliers',
            bills: 'bills',
            customers: 'customers',
            inventory: 'inventory',
            stock_in: 'stock_in',
            cash_submissions: 'user_cash_submission'
        };
        this.columnCache = new Map();
    }

    // ===== GENERIC CRUD =====
    
    insert(table, data) {
        const id = data.id || uuidv4();
        const now = new Date().toISOString();
        const cleanData = this.filterColumns(table, { ...data, id });
        
        const columns = Object.keys(cleanData);
        const values = columns.map(col => cleanData[col]);

        if (this.hasColumn(table, 'updated_at') && !cleanData.updated_at) {
            columns.push('updated_at');
            values.push(now);
        }
        if (this.hasColumn(table, 'created_at') && !cleanData.created_at) {
            columns.push('created_at');
            values.push(now);
        }

        const placeholders = columns.map(() => '?').join(',');
        
        const stmt = db.prepare(
            `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`
        );
        
        try {
            const result = stmt.run(values);
            return { id, ...cleanData };
        } catch (error) {
            console.error(`Insert error in ${table}:`, error);
            throw error;
        }
    }

    update(table, id, data) {
        const cleanData = this.filterColumns(table, data);
        delete cleanData.id;

        const columns = Object.keys(cleanData);
        if (columns.length === 0) {
            return { id };
        }

        const setClause = columns.map(col => `${col} = ?`).join(',');
        const values = columns.map(col => cleanData[col]);
        const timestampClause = this.hasColumn(table, 'updated_at') ? ', updated_at = CURRENT_TIMESTAMP' : '';
        const deleteClause = this.hasColumn(table, 'is_deleted') ? ' AND is_deleted = 0' : '';
        
        const stmt = db.prepare(
            `UPDATE ${table} SET ${setClause}${timestampClause} WHERE id = ?${deleteClause}`
        );
        
        try {
            const result = stmt.run(values.concat(id));
            return { id, ...cleanData };
        } catch (error) {
            console.error(`Update error in ${table}:`, error);
            throw error;
        }
    }

    softDelete(table, id) {
        if (!this.hasColumn(table, 'is_deleted')) {
            return this.hardDelete(table, id);
        }

        const stmt = db.prepare(
            `UPDATE ${table} SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        );
        return stmt.run(id);
    }

    hardDelete(table, id) {
        const stmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
        return stmt.run(id);
    }

    findById(table, id) {
        const deleteClause = this.hasColumn(table, 'is_deleted') ? ' AND is_deleted = 0' : '';
        const stmt = db.prepare(`SELECT * FROM ${table} WHERE id = ?${deleteClause}`);
        return stmt.get(id);
    }

    find(table, id) {
        return this.findById(table, id);
    }

    findAll(table, conditions = {}, limit = null, orderBy = null) {
        let query = `SELECT * FROM ${table} WHERE 1 = 1`;
        const values = [];

        if (this.hasColumn(table, 'is_deleted')) {
            query += ' AND is_deleted = 0';
        }
        
        const keys = Object.keys(conditions);
        if (keys.length > 0) {
            query += ' AND ' + keys.map(key => `${key} = ?`).join(' AND ');
            values.push(...keys.map(key => conditions[key]));
        }
        
        if (orderBy) {
            query += ` ORDER BY ${orderBy}`;
        }
        
        if (limit) {
            query += ' LIMIT ?';
            values.push(limit);
        }
        
        const stmt = db.prepare(query);
        return stmt.all(values);
    }

    findByShop(table, shopId, conditions = {}) {
        return this.findAll(table, { shop_id: shopId, ...conditions });
    }

    // ===== EMPLOYEE SPECIFIC =====
    
    createEmployee(data) {
        const id = data.id || uuidv4();
        const employeeData = {
            id,
            shop_id: data.shop_id,
            role_id: data.role_id || null,
            name: data.name,
            email: data.email,
            password: data.password || 'default123', // Will be hashed
            phone: data.phone || null,
            salary: data.salary || 0,
            loan: data.loan || 0,
            cnic: data.cnic || null,
            status: data.status || 'active',
            profile_picture: data.profile_picture || null,
            notes: data.notes || null,
            uuid: data.uuid || uuidv4(),
            sync_status: 'pending'
        };
        
        return this.insert('users', employeeData);
    }

    updateEmployee(id, data) {
        return this.update('users', id, data);
    }

    deleteEmployee(id) {
        return this.softDelete('users', id);
    }

    getEmployee(id) {
        return this.findById('users', id);
    }

    getAllEmployees(shopId) {
        return this.findByShop('users', shopId, { status: 'active' });
    }

    getEmployeeByEmail(email) {
        const deleteClause = this.hasColumn('users', 'is_deleted') ? ' AND is_deleted = 0' : '';
        const stmt = db.prepare(`SELECT * FROM users WHERE email = ?${deleteClause}`);
        return stmt.get(email);
    }

    getEmployeesByRole(shopId, roleId) {
        return this.findByShop('users', shopId, { role_id: roleId, status: 'active' });
    }

    // ===== SYNC QUEUE =====
    
    addToSyncQueue(tableName, recordId, action, payload = null) {
        const stmt = db.prepare(`
            INSERT INTO sync_queue (table_name, record_id, action, payload, status)
            VALUES (?, ?, ?, ?, 'pending')
        `);
        return stmt.run(tableName, recordId, action, payload || JSON.stringify({}));
    }

    getPendingSyncItems() {
        const stmt = db.prepare(`
            SELECT * FROM sync_queue 
            WHERE status = 'pending' 
            ORDER BY created_at ASC
            LIMIT 100
        `);
        return stmt.all();
    }

    markSyncCompleted(id) {
        const stmt = db.prepare(`
            UPDATE sync_queue 
            SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `);
        return stmt.run(id);
    }

    markSyncFailed(id, error) {
        const stmt = db.prepare(`
            UPDATE sync_queue 
            SET status = 'failed', 
                attempts = attempts + 1,
                error = ?,
                updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `);
        return stmt.run(error, id);
    }

    clearSyncQueue() {
        const stmt = db.prepare(`DELETE FROM sync_queue WHERE status IN ('completed', 'failed')`);
        return stmt.run();
    }

    getLastSyncTime(tableName) {
        const stmt = db.prepare('SELECT last_synced_at FROM sync_metadata WHERE table_name = ?');
        const row = stmt.get(tableName);
        return row?.last_synced_at || null;
    }

    updateLastSyncTime(tableName, status = 'success', count = 0) {
        const stmt = db.prepare(`
            INSERT INTO sync_metadata (table_name, last_synced_at, last_sync_status, last_sync_count)
            VALUES (?, CURRENT_TIMESTAMP, ?, ?)
            ON CONFLICT(table_name) DO UPDATE SET
                last_synced_at = excluded.last_synced_at,
                last_sync_status = excluded.last_sync_status,
                last_sync_count = excluded.last_sync_count
        `);
        return stmt.run(tableName, status, count);
    }

    removePendingForRecord(tableName, recordId) {
        const stmt = db.prepare(`
            DELETE FROM sync_queue
            WHERE table_name = ? AND record_id = ? AND status = 'pending'
        `);
        return stmt.run(tableName, recordId);
    }

    getColumns(table) {
        if (!this.columnCache.has(table)) {
            const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
            this.columnCache.set(table, new Set(columns));
        }
        return this.columnCache.get(table);
    }

    hasColumn(table, column) {
        return this.getColumns(table).has(column);
    }

    filterColumns(table, data) {
        const columns = this.getColumns(table);
        return Object.fromEntries(
            Object.entries(data).filter(([key]) => columns.has(key))
        );
    }
}

module.exports = new DatabaseService();
