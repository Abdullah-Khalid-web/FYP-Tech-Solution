const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// Apply all routes from the controller
router.use('/', productController);

module.exports = router;