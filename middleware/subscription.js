const { pool } = require('../db');

async function checkSubscription(req, res, next) {
    const shopId = req.session.shopId;
    if (!shopId) {
        return res.status(403).json({ error: 'No shop found' });
    }

    try {
        const [subscriptions] = await pool.execute(
            `SELECT status, expires_at 
             FROM subscriptions 
             WHERE shop_id = UUID_TO_BIN(?) 
             ORDER BY expires_at DESC 
             LIMIT 1`,
            [shopId]
        );

        if (subscriptions.length === 0) {
            // Free tier - limited features
            req.subscription = { status: 'free' };
            return next();
        }

        const sub = subscriptions[0];
        const now = new Date();
        const expiresAt = new Date(sub.expires_at);

        if (sub.status === 'expired' || expiresAt < now) {
            return res.status(403).render('subscription/expired', {
                title: 'Subscription Expired',
                shop: req.session.shopName
            });
        }

        req.subscription = sub;
        next();

    } catch (error) {
        console.error('Subscription check error:', error);
        return res.status(500).json({ error: 'Subscription check failed' });
    }
}

module.exports = { checkSubscription };