const express = require('express');
const router = express.Router();
const registerController = require('../../controllers/registerController');
const stripeController = require('../../controllers/stripeController');
const multer = require('multer');

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}.${ext}`);
  }
});
const upload = multer({ storage });

router.post('/create-payment-intent', stripeController.createPaymentIntent);
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), stripeController.handleWebhook);

router.get('/register', registerController.showRegister);
router.post('/register', upload.single('logo'), registerController.register);

router.get('/payment-success', (req, res) => {
  res.render('auth/payment-success');
});

router.get('/payment-failed', (req, res) => {
  res.render('auth/payment-failed');
});

module.exports = router;
