const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');

// Apply all routes from the controller
router.use('/', feedbackController);

module.exports = router;