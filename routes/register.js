const express = require('express');
const router = express.Router();
const registerController = require('../controllers/registerController');
const stripeController = require('../controllers/stripeController');

// Add debug middleware to log all requests to this router
router.use((req, res, next) => {
    console.log('Register Router - Request:', req.method, req.path);
    next();
});

// Add this at the VERY TOP of register.js, before any other routes
router.post('/create-payment-intent', (req, res, next) => {
    console.log('=== CREATE PAYMENT INTENT ROUTE HIT ===');
    console.log('Body:', req.body);
    console.log('Content-Type:', req.headers['content-type']);
    
    // If we get here, the route is working
    // Pass to the actual controller
    next();
}, stripeController.createPaymentIntent);

/* SHOW REGISTER FORM */
router.get('/register', registerController.showRegister);

/* HANDLE REGISTER */
router.post('/register', registerController.register);

// Stripe routes - Put these BEFORE the register route to ensure they match first
router.post('/create-payment-intent', stripeController.createPaymentIntent);
router.post('/stripe-webhook', express.raw({type: 'application/json'}), stripeController.handleWebhook);
router.get('/payment-success', (req, res) => {
    res.render('auth/payment-success');
});
router.get('/payment-failed', (req, res) => {
    res.render('auth/payment-failed');
});

module.exports = router;