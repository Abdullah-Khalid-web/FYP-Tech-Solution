const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');

// Apply all routes from the controller
router.use('/', supplierController);

module.exports = router;