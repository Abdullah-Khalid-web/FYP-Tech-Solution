const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Get all active pricing plans
router.get('/pricing-plans', async (req, res) => {
    try {
        const sql = 'SELECT * FROM pricing_plans WHERE status = "active" ORDER BY monthly_price ASC';
        const [results] = await pool.promise().query(sql);
        
        // Parse JSON features field
        const plans = results.map(plan => ({
            ...plan,
            features: JSON.parse(plan.features)
        }));
        
        res.json(plans);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Failed to fetch pricing plans' });
    }
});

// Get single pricing plan by ID
router.get('/pricing-plans/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const sql = 'SELECT * FROM pricing_plans WHERE id = ? AND status = "active"';
        const [results] = await pool.promise().query(sql, [id]);
        
        if (results.length === 0) {
            return res.status(404).json({ error: 'Pricing plan not found' });
        }
        
        const plan = {
            ...results[0],
            features: JSON.parse(results[0].features)
        };
        
        res.json(plan);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Failed to fetch pricing plan' });
    }
});

// Calculate discounted prices (quarterly and yearly)
function calculateDiscountedPrices(monthlyPrice) {
    const quarterlyDiscount = 0.10; // 10% discount for quarterly
    const yearlyDiscount = 0.20;   // 20% discount for yearly
    
    return {
        quarterly: (monthlyPrice * 3 * (1 - quarterlyDiscount)).toFixed(2),
        yearly: (monthlyPrice * 12 * (1 - yearlyDiscount)).toFixed(2)
    };
}

// Get pricing plans with calculated discounts
router.get('/pricing-plans-with-discounts', async (req, res) => {
    try {
        const sql = 'SELECT * FROM pricing_plans WHERE status = "active" ORDER BY monthly_price ASC';
        const [results] = await pool.promise().query(sql);
        
        const plans = results.map(plan => {
            const discounts = calculateDiscountedPrices(plan.monthly_price);
            
            return {
                ...plan,
                features: JSON.parse(plan.features),
                discounted_prices: {
                    quarterly: discounts.quarterly,
                    yearly: discounts.yearly
                },
                savings: {
                    quarterly: (plan.monthly_price * 3 - discounts.quarterly).toFixed(2),
                    yearly: (plan.monthly_price * 12 - discounts.yearly).toFixed(2)
                }
            };
        });
        
        res.json(plans);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Failed to fetch pricing plans' });
    }
});

module.exports = router;