const express = require('express');
const router = express.Router();
const billController = require('../controllers/billController');

// Apply all routes from the controller
router.use('/', billController);

module.exports = router;