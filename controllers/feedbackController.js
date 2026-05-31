const { pool } = require('../db');
const { format } = require('date-fns');
const ExcelJS = require('exceljs');

class FeedbackController {
    // Get shop info middleware
    async getShopInfo(req, res, next) {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        try {
            // Get shop_id from user
            const [users] = await pool.execute(
                'SELECT BIN_TO_UUID(shop_id) as shop_id FROM users WHERE id = UUID_TO_BIN(?)',
                [req.session.userId]
            );

            if (users.length === 0 || !users[0].shop_id) {
                return res.status(403).json({ success: false, message: 'Shop not found' });
            }

            req.shopId = users[0].shop_id;

            // Get shop details
            const [shops] = await pool.execute(
                'SELECT name, logo, currency, primary_color, secondary_color FROM shops WHERE id = UUID_TO_BIN(?)',
                [req.shopId]
            );

            if (shops.length > 0) {
                req.shop = {
                    id: req.shopId,
                    name: shops[0].name || 'My Shop',
                    logo: shops[0].logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
                    currency: shops[0].currency || 'PKR',
                    primary_color: shops[0].primary_color || '#007bff',
                    secondary_color: shops[0].secondary_color || '#6c757d'
                };
            } else {
                req.shop = {
                    id: req.shopId,
                    name: 'My Shop',
                    logo: '/images/default-logo.png',
                    currency: 'PKR',
                    primary_color: '#007bff',
                    secondary_color: '#6c757d'
                };
            }
            next();
        } catch (err) {
            console.error('Error in getShopInfo middleware:', err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    // GET user's feedback page (logged-in users)
    async getUserFeedback(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = 10;
            const offset = (page - 1) * limit;

            // Get user's feedback
            const [feedback] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(id) as id,
                    subject,
                    message,
                    rating,
                    status,
                    admin_notes,
                    admin_reply,
                    replied_at,
                    created_at,
                    updated_at
                 FROM feedback 
                 WHERE shop_id = UUID_TO_BIN(?) AND user_id = UUID_TO_BIN(?)
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [req.shopId, req.session.userId, limit, offset]
            );

            // Get total count
            const [countResult] = await pool.execute(
                'SELECT COUNT(*) as total FROM feedback WHERE shop_id = UUID_TO_BIN(?) AND user_id = UUID_TO_BIN(?)',
                [req.shopId, req.session.userId]
            );

            const total = countResult[0].total;
            const totalPages = Math.ceil(total / limit);

            // Get counts by status for stats
            const [statusCounts] = await pool.execute(
                `SELECT 
                    status,
                    COUNT(*) as count
                 FROM feedback 
                 WHERE shop_id = UUID_TO_BIN(?) AND user_id = UUID_TO_BIN(?)
                 GROUP BY status`,
                [req.shopId, req.session.userId]
            );

            // Calculate average rating
            const [avgRatingResult] = await pool.execute(
                `SELECT AVG(rating) as avg_rating 
                 FROM feedback 
                 WHERE shop_id = UUID_TO_BIN(?) AND user_id = UUID_TO_BIN(?) AND rating IS NOT NULL`,
                [req.shopId, req.session.userId]
            );

            const stats = {
                total: total,
                byStatus: {},
                avgRating: avgRatingResult[0].avg_rating ? parseFloat(avgRatingResult[0].avg_rating).toFixed(1) : null
            };

            // Convert status counts to object
            statusCounts.forEach(item => {
                stats.byStatus[item.status] = item.count;
            });

            res.render('feedback/user-feedback', {
                title: 'My Feedback',
                feedback: feedback || [],
                stats: stats,
                currentPage: page,
                totalPages: totalPages,
                shop: req.shop
            });
        } catch (err) {
            console.error('Error fetching user feedback:', err);
            res.status(500).render('error', {
                title: 'Error',
                message: 'An error occurred while loading your feedback'
            });
        }
    }

    // GET submit feedback form (for logged-in users)
    async getSubmitForm(req, res) {
        try {
            res.render('feedback/submit', {
                title: 'Submit Feedback',
                shop: req.shop,
                success: req.query.success,
                error: req.query.error
            });
        } catch (err) {
            console.error('Error loading submit form:', err);
            res.status(500).render('error', {
                title: 'Error',
                message: 'Failed to load feedback form'
            });
        }
    }

    // POST submit feedback (for logged-in users)
    async submitFeedback(req, res) {
        try {
            const { subject, message, rating } = req.body;

            if (!subject || !message) {
                if (req.xhr || req.headers.accept?.includes('json')) {
                    return res.status(400).json({
                        success: false,
                        message: 'Subject and message are required'
                    });
                }
                return res.redirect('/feedback/submit?error=Subject and message are required');
            }

            await pool.execute(
                `INSERT INTO feedback (id, shop_id, user_id, subject, message, rating, status, created_at)
                 VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, 'new', NOW())`,
                [req.shopId, req.session.userId, subject, message, rating || null]
            );

            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.json({
                    success: true,
                    message: 'Feedback submitted successfully! Our team will review it shortly.'
                });
            }

            res.redirect('/feedback?success=Feedback submitted successfully!');
        } catch (err) {
            console.error('Error submitting feedback:', err);
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to submit feedback'
                });
            }
            res.redirect('/feedback/submit?error=Failed to submit feedback');
        }
    }

    // GET single feedback details (for logged-in users)
    async getFeedbackDetails(req, res) {
        try {
            const feedbackId = req.params.id;

            const [feedback] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(id) as id,
                    subject,
                    message,
                    rating,
                    status,
                    admin_notes,
                    admin_reply,
                    replied_at,
                    created_at,
                    updated_at,
                    BIN_TO_UUID(replied_by) as replied_by_id
                 FROM feedback 
                 WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?) AND user_id = UUID_TO_BIN(?)`,
                [feedbackId, req.shopId, req.session.userId]
            );

            if (feedback.length === 0) {
                return res.status(404).render('error', {
                    title: 'Not Found',
                    message: 'Feedback not found'
                });
            }

            res.render('feedback/view', {
                title: 'Feedback Details',
                feedback: feedback[0],
                shop: req.shop
            });
        } catch (err) {
            console.error('Error fetching feedback details:', err);
            res.status(500).render('error', {
                title: 'Error',
                message: 'An error occurred while loading feedback details'
            });
        }
    }

    // ==================== ADMIN FUNCTIONS ====================

    // GET all feedback for admin (with filters)
    async getAdminFeedback(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            // Get filters
            const filters = {
                status: req.query.status || 'all',
                rating: req.query.rating || 'all',
                date_from: req.query.date_from || null,
                date_to: req.query.date_to || null,
                search: req.query.search || ''
            };

            // Build WHERE clause
            let whereConditions = ['f.shop_id = UUID_TO_BIN(?)'];
            let params = [req.shopId];

            if (filters.status !== 'all') {
                whereConditions.push('f.status = ?');
                params.push(filters.status);
            }

            if (filters.rating !== 'all') {
                whereConditions.push('f.rating = ?');
                params.push(parseInt(filters.rating));
            }

            if (filters.date_from) {
                whereConditions.push('DATE(f.created_at) >= ?');
                params.push(filters.date_from);
            }

            if (filters.date_to) {
                whereConditions.push('DATE(f.created_at) <= ?');
                params.push(filters.date_to);
            }

            if (filters.search) {
                whereConditions.push('(f.subject LIKE ? OR f.message LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
                params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
            }

            const whereClause = whereConditions.join(' AND ');

            // Get total count
            const [countResult] = await pool.execute(
                `SELECT COUNT(*) as total FROM feedback f WHERE ${whereClause}`,
                params
            );
            const totalRecords = countResult[0].total;
            const totalPages = Math.ceil(totalRecords / limit);

            // Get feedback with user info
            const [feedback] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(f.id) as id,
                    f.subject,
                    f.message,
                    f.rating,
                    f.status,
                    f.admin_notes,
                    f.admin_reply,
                    f.created_at,
                    f.updated_at,
                    f.replied_at,
                    BIN_TO_UUID(f.user_id) as user_id,
                    u.name as user_name,
                    u.email as user_email,
                    u.phone as user_phone,
                    BIN_TO_UUID(f.replied_by) as replied_by_id,
                    ru.name as replied_by_name
                FROM feedback f
                LEFT JOIN users u ON f.user_id = u.id
                LEFT JOIN users ru ON f.replied_by = ru.id
                WHERE ${whereClause}
                ORDER BY 
                    CASE f.status 
                        WHEN 'new' THEN 1 
                        WHEN 'read' THEN 2 
                        WHEN 'replied' THEN 3 
                        WHEN 'resolved' THEN 4 
                    END,
                    f.created_at DESC
                LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            // Get summary statistics
            const [summary] = await pool.execute(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
                    COUNT(CASE WHEN status = 'read' THEN 1 END) as read_count,
                    COUNT(CASE WHEN status = 'replied' THEN 1 END) as replied_count,
                    COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_count,
                    ROUND(AVG(rating), 1) as avg_rating
                FROM feedback
                WHERE shop_id = UUID_TO_BIN(?)`,
                [req.shopId]
            );

            // Get rating distribution
            const [ratingDistribution] = await pool.execute(
                `SELECT 
                    rating,
                    COUNT(*) as count
                FROM feedback
                WHERE shop_id = UUID_TO_BIN(?) AND rating IS NOT NULL
                GROUP BY rating
                ORDER BY rating DESC`,
                [req.shopId]
            );

            res.render('feedback/admin-feedback', {
                title: 'Feedback Management',
                feedbackList: feedback,
                filters,
                summary: summary[0],
                ratingDistribution,
                shop: req.shop,
                currentPage: page,
                totalPages,
                totalRecords,
                currentUser: req.session.userId,
                success: req.query.success,
                error: req.query.error
            });
        } catch (err) {
            console.error('Error loading admin feedback:', err);
            res.status(500).render('error', {
                title: 'Error',
                message: 'Failed to load feedback'
            });
        }
    }

    // POST reply to feedback (admin)
    async replyToFeedback(req, res) {
        let connection;
        try {
            const { id } = req.params;
            const { admin_reply, status } = req.body;

            if (!admin_reply || admin_reply.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Reply message is required'
                });
            }

            connection = await pool.getConnection();
            await connection.beginTransaction();

            const [feedback] = await connection.execute(
                `SELECT status FROM feedback 
                WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [id, req.shopId]
            );

            if (feedback.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Feedback not found'
                });
            }

            const newStatus = status || (feedback[0].status === 'replied' ? 'replied' : 'replied');

            await connection.execute(
                `UPDATE feedback 
                SET admin_reply = ?,
                    status = ?,
                    replied_at = NOW(),
                    replied_by = UUID_TO_BIN(?),
                    updated_at = NOW()
                WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [admin_reply, newStatus, req.session.userId, id, req.shopId]
            );

            await connection.commit();

            res.json({
                success: true,
                message: 'Reply sent successfully'
            });
        } catch (err) {
            if (connection) await connection.rollback();
            console.error('Error replying to feedback:', err);
            res.status(500).json({
                success: false,
                message: 'Failed to send reply'
            });
        } finally {
            if (connection) connection.release();
        }
    }

    // POST update feedback status (admin)
    async updateStatus(req, res) {
        try {
            const { id } = req.params;
            const { status } = req.body;

            const validStatuses = ['new', 'read', 'replied', 'resolved'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status'
                });
            }

            const [result] = await pool.execute(
                `UPDATE feedback 
                SET status = ?, updated_at = NOW()
                WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [status, id, req.shopId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Feedback not found'
                });
            }

            res.json({
                success: true,
                message: 'Status updated successfully'
            });
        } catch (err) {
            console.error('Error updating status:', err);
            res.status(500).json({
                success: false,
                message: 'Failed to update status'
            });
        }
    }

    // DELETE feedback (admin)
    async deleteFeedback(req, res) {
        try {
            const { id } = req.params;

            const [result] = await pool.execute(
                `DELETE FROM feedback 
                WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [id, req.shopId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Feedback not found'
                });
            }

            res.json({
                success: true,
                message: 'Feedback deleted successfully'
            });
        } catch (err) {
            console.error('Error deleting feedback:', err);
            res.status(500).json({
                success: false,
                message: 'Failed to delete feedback'
            });
        }
    }

    // GET feedback details for admin modal
    async getFeedbackForAdmin(req, res) {
        try {
            const { id } = req.params;

            const [feedback] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(f.id) as id,
                    f.subject,
                    f.message,
                    f.rating,
                    f.status,
                    f.admin_notes,
                    f.admin_reply,
                    f.created_at,
                    f.replied_at,
                    BIN_TO_UUID(f.user_id) as user_id,
                    u.name as user_name,
                    u.email as user_email,
                    u.phone as user_phone,
                    BIN_TO_UUID(f.replied_by) as replied_by_id,
                    ru.name as replied_by_name
                FROM feedback f
                LEFT JOIN users u ON f.user_id = u.id
                LEFT JOIN users ru ON f.replied_by = ru.id
                WHERE f.id = UUID_TO_BIN(?) AND f.shop_id = UUID_TO_BIN(?)`,
                [id, req.shopId]
            );

            if (feedback.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Feedback not found'
                });
            }

            res.json({
                success: true,
                feedback: feedback[0]
            });
        } catch (err) {
            console.error('Error fetching feedback details:', err);
            res.status(500).json({
                success: false,
                message: 'Failed to load feedback details'
            });
        }
    }

    // Export feedback to Excel (admin)
    async exportFeedback(req, res) {
        try {
            const { status, rating, date_from, date_to } = req.query;

            let query = `
                SELECT 
                    DATE(f.created_at) as 'Date',
                    f.subject as 'Subject',
                    f.message as 'Message',
                    f.rating as 'Rating',
                    f.status as 'Status',
                    COALESCE(u.name, 'Guest') as 'User Name',
                    COALESCE(u.email, 'N/A') as 'User Email',
                    f.admin_reply as 'Admin Reply',
                    f.replied_at as 'Replied At'
                FROM feedback f
                LEFT JOIN users u ON f.user_id = u.id
                WHERE f.shop_id = UUID_TO_BIN(?)
            `;
            let params = [req.shopId];

            if (status && status !== 'all') {
                query += ` AND f.status = ?`;
                params.push(status);
            }

            if (rating && rating !== 'all') {
                query += ` AND f.rating = ?`;
                params.push(parseInt(rating));
            }

            if (date_from) {
                query += ` AND DATE(f.created_at) >= ?`;
                params.push(date_from);
            }

            if (date_to) {
                query += ` AND DATE(f.created_at) <= ?`;
                params.push(date_to);
            }

            query += ` ORDER BY f.created_at DESC`;

            const [feedback] = await pool.execute(query, params);

            const [[shop]] = await pool.execute(
                `SELECT name FROM shops WHERE id = UUID_TO_BIN(?)`,
                [req.shopId]
            );

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Feedback Report');

            const headers = Object.keys(feedback[0] || {});
            worksheet.addRow(headers);

            const headerRow = worksheet.getRow(1);
            headerRow.font = { bold: true };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4E73DF' }
            };
            headerRow.font = { color: { argb: 'FFFFFFFF' }, bold: true };

            feedback.forEach(item => {
                const row = headers.map(header => item[header]);
                worksheet.addRow(row);
            });

            worksheet.columns.forEach(column => {
                let maxLength = 10;
                column.eachCell({ includeEmpty: true }, cell => {
                    const cellLength = cell.value ? String(cell.value).length : 10;
                    maxLength = Math.max(maxLength, cellLength);
                });
                column.width = Math.min(maxLength + 2, 40);
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=feedback_report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);

            await workbook.xlsx.write(res);
            res.end();
        } catch (err) {
            console.error('Export error:', err);
            res.status(500).json({ success: false, message: 'Export failed' });
        }
    }
}

module.exports = new FeedbackController();