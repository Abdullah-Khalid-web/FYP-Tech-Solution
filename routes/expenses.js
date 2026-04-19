const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');

// Apply all routes from the controller
router.use('/', expenseController);

module.exports = router;