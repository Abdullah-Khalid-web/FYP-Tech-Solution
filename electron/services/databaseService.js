const { getDatabase, persistDatabase } = require('../database/init');
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
            cash_submissions: 'user_cash_submission',
            user_loans: 'user_loan',
            user_loan_ledgers: 'user_loan_ledger',
            user_salaries: 'user_salary',
            cash_registers: 'cash_register',
            raw_materials: 'raw_materials',
            raw_material_stock_movements: 'raw_material_stock_movements',
            ingredients: 'ingredients',
            supplier_transactions: 'supplier_transactions',
            supplier_balances: 'supplier_balance'
        };
        this.columnCache = new Map();
    }

    async getDb() {
        return getDatabase();
    }

    async runSelect(db, sql, params = []) {
        const statement = db.prepare(sql);
        try {
            return statement.all(params);
        } finally {
            if (statement.free) {
                statement.free();
            }
        }
    }

    async runMutation(db, sql, params = []) {
        db.run(sql, params);
        await persistDatabase();
        return {
            changes: typeof db.getRowsModified === 'function' ? db.getRowsModified() : 0
        };
    }

    // ===== GENERIC CRUD =====

    async insert(table, data) {
        const db = await this.getDb();
        const id = data.id || uuidv4();
        const now = new Date().toISOString();
        const cleanData = await this.filterColumns(table, { ...data, id });

        const columns = Object.keys(cleanData);
        const values = columns.map((col) => cleanData[col]);

        if (await this.hasColumn(table, 'updated_at') && !cleanData.updated_at) {
            columns.push('updated_at');
            values.push(now);
        }
        if (await this.hasColumn(table, 'created_at') && !cleanData.created_at) {
            columns.push('created_at');
            values.push(now);
        }

        const placeholders = columns.map(() => '?').join(',');

        try {
            await this.runMutation(
                db,
                `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`,
                values
            );
            return { id, ...cleanData };
        } catch (error) {
            console.error(`Insert error in ${table}:`, error);
            throw error;
        }
    }

    async update(table, id, data) {
        const db = await this.getDb();
        const cleanData = await this.filterColumns(table, data);
        delete cleanData.id;

        const columns = Object.keys(cleanData);
        if (columns.length === 0) {
            return { id };
        }

        const setClause = columns.map((col) => `${col} = ?`).join(',');
        const values = columns.map((col) => cleanData[col]);
        const timestampClause = await this.hasColumn(table, 'updated_at') ? ', updated_at = CURRENT_TIMESTAMP' : '';
        const deleteClause = await this.hasColumn(table, 'is_deleted') ? ' AND is_deleted = 0' : '';

        try {
            await this.runMutation(
                db,
                `UPDATE ${table} SET ${setClause}${timestampClause} WHERE id = ?${deleteClause}`,
                values.concat(id)
            );
            return { id, ...cleanData };
        } catch (error) {
            console.error(`Update error in ${table}:`, error);
            throw error;
        }
    }

    async softDelete(table, id) {
        if (!(await this.hasColumn(table, 'is_deleted'))) {
            return this.hardDelete(table, id);
        }

        const db = await this.getDb();
        return this.runMutation(
            db,
            `UPDATE ${table} SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [id]
        );
    }

    async hardDelete(table, id) {
        const db = await this.getDb();
        return this.runMutation(db, `DELETE FROM ${table} WHERE id = ?`, [id]);
    }

    async findById(table, id) {
        const db = await this.getDb();
        const deleteClause = await this.hasColumn(table, 'is_deleted') ? ' AND is_deleted = 0' : '';
        const rows = await this.runSelect(db, `SELECT * FROM ${table} WHERE id = ?${deleteClause}`, [id]);
        return rows[0] || null;
    }

    async find(table, id) {
        return this.findById(table, id);
    }

    async findAll(table, conditions = {}, limit = null, orderBy = null) {
        const db = await this.getDb();
        let query = `SELECT * FROM ${table} WHERE 1 = 1`;
        const values = [];

        if (await this.hasColumn(table, 'is_deleted')) {
            query += ' AND is_deleted = 0';
        }

        const keys = Object.keys(conditions);
        if (keys.length > 0) {
            query += ' AND ' + keys.map((key) => `${key} = ?`).join(' AND ');
            values.push(...keys.map((key) => conditions[key]));
        }

        if (orderBy) {
            query += ` ORDER BY ${orderBy}`;
        }

        if (limit) {
            query += ' LIMIT ?';
            values.push(limit);
        }

        return this.runSelect(db, query, values);
    }

    async findByShop(table, shopId, conditions = {}) {
        return this.findAll(table, { shop_id: shopId, ...conditions });
    }

    // ===== EMPLOYEE SPECIFIC =====

    async createEmployee(data) {
        const id = data.id || uuidv4();
        const employeeData = {
            id,
            shop_id: data.shop_id,
            role_id: data.role_id || null,
            name: data.name,
            email: data.email,
            password: data.password || 'default123',
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

        await this.insert('users', employeeData);
        return employeeData;
    }

    async updateEmployee(id, data) {
        return this.update('users', id, data);
    }

    async deleteEmployee(id) {
        return this.softDelete('users', id);
    }

    async getEmployee(id) {
        return this.findById('users', id);
    }

    async getAllEmployees(shopId) {
        return this.findByShop('users', shopId, { status: 'active' });
    }

    async getEmployeeByEmail(email) {
        const db = await this.getDb();
        const deleteClause = await this.hasColumn('users', 'is_deleted') ? ' AND is_deleted = 0' : '';
        const rows = await this.runSelect(db, `SELECT * FROM users WHERE email = ?${deleteClause}`, [email]);
        return rows[0] || null;
    }

    async getEmployeesByRole(shopId, roleId) {
        return this.findByShop('users', shopId, { role_id: roleId, status: 'active' });
    }

    // ===== SYNC QUEUE =====

    async addToSyncQueue(tableName, recordId, action, payload = null) {
        const db = await this.getDb();
        return this.runMutation(
            db,
            `INSERT INTO sync_queue (table_name, record_id, action, payload, status)
             VALUES (?, ?, ?, ?, 'pending')`,
            [tableName, recordId, action, payload || JSON.stringify({})]
        );
    }

    async getPendingSyncItems(limit = 100) {
        const db = await this.getDb();
        await this.runMutation(
            db,
            `UPDATE sync_queue
             SET status = 'pending', updated_at = CURRENT_TIMESTAMP
             WHERE status = 'failed' AND attempts < 5`
        );
        return this.runSelect(db, `
            SELECT * FROM sync_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ${Number(limit) || 100}
        `);
    }

    async getPendingSyncCount() {
        const db = await this.getDb();
        const rows = await this.runSelect(db, `SELECT COUNT(*) as c FROM sync_queue WHERE status = 'pending'`);
        return rows[0]?.c || 0;
    }

    async markSyncCompleted(id) {
        const db = await this.getDb();
        return this.runMutation(
            db,
            `UPDATE sync_queue 
             SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [id]
        );
    }

    async markSyncFailed(id, error) {
        const db = await this.getDb();
        return this.runMutation(
            db,
            `UPDATE sync_queue 
             SET status = 'failed', 
                 attempts = attempts + 1,
                 error = ?,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [error, id]
        );
    }

    // Purges completed items immediately, but only purges failed items once
    // they've exhausted all retry attempts (matches the attempts < 5 cap in
    // getPendingSyncItems) -- otherwise this would prematurely give up on
    // items that are still eligible for another retry.
    async clearSyncQueue() {
        const db = await this.getDb();
        return this.runMutation(db, `DELETE FROM sync_queue WHERE status = 'completed' OR (status = 'failed' AND attempts >= 5)`);
    }

    async getLastSyncTime(tableName) {
        const db = await this.getDb();
        const rows = await this.runSelect(db, 'SELECT last_synced_at FROM sync_metadata WHERE table_name = ?', [tableName]);
        return rows[0]?.last_synced_at || null;
    }

    async updateLastSyncTime(tableName, status = 'success', count = 0) {
        const db = await this.getDb();
        return this.runMutation(
            db,
            `INSERT INTO sync_metadata (table_name, last_synced_at, last_sync_status, last_sync_count)
             VALUES (?, CURRENT_TIMESTAMP, ?, ?)
             ON CONFLICT(table_name) DO UPDATE SET
                 last_synced_at = excluded.last_synced_at,
                 last_sync_status = excluded.last_sync_status,
                 last_sync_count = excluded.last_sync_count`,
            [tableName, status, count]
        );
    }

    async removePendingForRecord(tableName, recordId) {
        const db = await this.getDb();
        return this.runMutation(
            db,
            `DELETE FROM sync_queue
             WHERE table_name = ? AND record_id = ? AND status = 'pending'`,
            [tableName, recordId]
        );
    }

    async getColumns(table) {
        if (!this.columnCache.has(table)) {
            const db = await this.getDb();
            const rows = await this.runSelect(db, `PRAGMA table_info(${table})`);
            const columns = rows.map((column) => column.name);
            this.columnCache.set(table, new Set(columns));
        }

        return this.columnCache.get(table);
    }

    async hasColumn(table, column) {
        const columns = await this.getColumns(table);
        return columns.has(column);
    }

    async filterColumns(table, data) {
        const columns = await this.getColumns(table);
        return Object.fromEntries(
            Object.entries(data).filter(([key]) => columns.has(key))
        );
    }
}

module.exports = new DatabaseService();
