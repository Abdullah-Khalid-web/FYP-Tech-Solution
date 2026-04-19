const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');

// Apply all routes from the controller
router.use('/', customerController);

module.exports = router;