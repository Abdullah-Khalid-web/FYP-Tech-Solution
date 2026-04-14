const { pool } = require('../db');

class FeedbackModel {
    static async create(shopId, subject, message, rating = null) {
        const query = `
            INSERT INTO feedback (id, shop_id, subject, message, rating, status)
            VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), ?, ?, ?, 'new')
        `;
        const [result] = await pool.execute(query, [shopId, subject, message, rating]);
        return result;
    }

    static async getByShop(shopId, page = 1, limit = 10) {
        const offset = (page - 1) * limit;
        const query = `
            SELECT 
                BIN_TO_UUID(id) as id,
                subject,
                message,
                rating,
                status,
                admin_notes,
                created_at,
                updated_at
            FROM feedback 
            WHERE shop_id = UUID_TO_BIN(?)
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `;
        const [rows] = await pool.execute(query, [shopId, limit, offset]);
        
        // Get total count
        const [countResult] = await pool.execute(
            'SELECT COUNT(*) as total FROM feedback WHERE shop_id = UUID_TO_BIN(?)',
            [shopId]
        );
        
        return {
            feedback: rows,
            total: countResult[0].total,
            page,
            totalPages: Math.ceil(countResult[0].total / limit)
        };
    }

    static async getById(feedbackId, shopId) {
        const query = `
            SELECT 
                BIN_TO_UUID(id) as id,
                subject,
                message,
                rating,
                status,
                admin_notes,
                created_at,
                updated_at
            FROM feedback 
            WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `;
        const [rows] = await pool.execute(query, [feedbackId, shopId]);
        return rows[0];
    }

    static async updateStatus(feedbackId, shopId, status) {
        const query = `
            UPDATE feedback 
            SET status = ?, updated_at = NOW()
            WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `;
        const [result] = await pool.execute(query, [status, feedbackId, shopId]);
        return result;
    }

    static async addAdminNotes(feedbackId, shopId, adminNotes) {
        const query = `
            UPDATE feedback 
            SET admin_notes = ?, updated_at = NOW(), status = 'replied'
            WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `;
        const [result] = await pool.execute(query, [adminNotes, feedbackId, shopId]);
        return result;
    }
}

module.exports = FeedbackModel;