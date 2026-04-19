const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Middleware to get shop info
const getShopInfo = async (req, res, next) => {
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
};

// GET feedback page
router.get('/', getShopInfo, async (req, res) => {
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
                created_at,
                updated_at
             FROM feedback 
             WHERE shop_id = UUID_TO_BIN(?)
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [req.shopId, limit, offset]
        );

        // Get total count
        const [countResult] = await pool.execute(
            'SELECT COUNT(*) as total FROM feedback WHERE shop_id = UUID_TO_BIN(?)',
            [req.shopId]
        );

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get counts by status for stats
        const [statusCounts] = await pool.execute(
            `SELECT 
                status,
                COUNT(*) as count
             FROM feedback 
             WHERE shop_id = UUID_TO_BIN(?)
             GROUP BY status`,
            [req.shopId]
        );

        // Calculate average rating
        const [avgRatingResult] = await pool.execute(
            `SELECT AVG(rating) as avg_rating 
             FROM feedback 
             WHERE shop_id = UUID_TO_BIN(?) AND rating IS NOT NULL`,
            [req.shopId]
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

        res.render('feedback/index', {
            title: 'Feedback & Support',
            feedback: feedback || [],
            stats: stats,
            currentPage: page,
            totalPages: totalPages,
            shop: req.shop
        });
    } catch (err) {
        console.error('Error fetching feedback:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An error occurred while loading feedback: ' + err.message
        });
    }
});

// GET new feedback form
router.get('/new', getShopInfo, (req, res) => {
    res.render('feedback/new', {
        title: 'Submit Feedback',
        shop: req.shop
    });
});

// POST submit feedback
router.post('/', getShopInfo, async (req, res) => {
    try {
        const { subject, message, rating } = req.body;

        // Validate required fields
        if (!subject || !message) {
            return res.status(400).json({
                success: false,
                message: 'Subject and message are required'
            });
        }

        // Insert feedback
        await pool.execute(
            `INSERT INTO feedback (id, shop_id, subject, message, rating, status)
             VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), ?, ?, ?, 'new')`,
            [req.shopId, subject, message, rating || null]
        );

        res.json({
            success: true,
            message: 'Feedback submitted successfully! Our team will review it shortly.'
        });
    } catch (err) {
        console.error('Error submitting feedback:', err);
        res.status(500).json({
            success: false,
            message: 'Error submitting feedback: ' + err.message
        });
    }
});

// GET single feedback details
router.get('/:id', getShopInfo, async (req, res) => {
    try {
        const feedbackId = req.params.id;

        // Get feedback details
        const [feedback] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                subject,
                message,
                rating,
                status,
                admin_notes,
                created_at,
                updated_at
             FROM feedback 
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [feedbackId, req.shopId]
        );

        if (feedback.length === 0) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Feedback not found'
            });
        }

        // Update status to 'read' if it's 'new'
        if (feedback[0].status === 'new') {
            await pool.execute(
                `UPDATE feedback 
                 SET status = 'read', updated_at = NOW()
                 WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [feedbackId, req.shopId]
            );
            feedback[0].status = 'read';
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
});

// POST mark feedback as resolved
router.post('/:id/resolve', getShopInfo, async (req, res) => {
    try {
        const feedbackId = req.params.id;

        // Update feedback status
        await pool.execute(
            `UPDATE feedback 
             SET status = 'resolved', updated_at = NOW()
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [feedbackId, req.shopId]
        );

        res.json({
            success: true,
            message: 'Feedback marked as resolved'
        });
    } catch (err) {
        console.error('Error marking feedback as resolved:', err);
        res.status(500).json({
            success: false,
            message: 'Error updating feedback status'
        });
    }
});

// POST delete feedback (soft delete - update status to cancelled)
router.post('/:id/delete', getShopInfo, async (req, res) => {
    try {
        const feedbackId = req.params.id;

        // Soft delete by marking as cancelled
        await pool.execute(
            `UPDATE feedback 
             SET status = 'cancelled', updated_at = NOW()
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [feedbackId, req.shopId]
        );

        res.json({
            success: true,
            message: 'Feedback deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting feedback:', err);
        res.status(500).json({
            success: false,
            message: 'Error deleting feedback'
        });
    }
});

// GET feedback statistics (for dashboard)
router.get('/stats', getShopInfo, async (req, res) => {
    try {
        // Get counts by status
        const [statusCounts] = await pool.execute(
            `SELECT 
                status,
                COUNT(*) as count
             FROM feedback 
             WHERE shop_id = UUID_TO_BIN(?)
             GROUP BY status`,
            [req.shopId]
        );

        // Calculate average rating
        const [avgRatingResult] = await pool.execute(
            `SELECT AVG(rating) as avg_rating 
             FROM feedback 
             WHERE shop_id = UUID_TO_BIN(?) AND rating IS NOT NULL`,
            [req.shopId]
        );

        // Get recent feedback (last 7 days)
        const [recentFeedback] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                subject,
                status,
                created_at
             FROM feedback 
             WHERE shop_id = UUID_TO_BIN(?) 
               AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
             ORDER BY created_at DESC
             LIMIT 5`,
            [req.shopId]
        );

        const stats = {
            byStatus: {},
            avgRating: avgRatingResult[0].avg_rating ? parseFloat(avgRatingResult[0].avg_rating).toFixed(1) : null,
            recentFeedback: recentFeedback || []
        };

        // Convert status counts to object
        statusCounts.forEach(item => {
            stats.byStatus[item.status] = item.count;
        });

        res.json({
            success: true,
            stats: stats
        });
    } catch (err) {
        console.error('Error fetching feedback stats:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching feedback statistics'
        });
    }
});

module.exports = router;