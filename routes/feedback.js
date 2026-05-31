const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const { isAuthenticated } = require('../middleware/auth');

// Apply shop info middleware to all routes
router.use(feedbackController.getShopInfo.bind(feedbackController));

// ==================== USER ROUTES ====================
router.get('/', isAuthenticated, feedbackController.getUserFeedback.bind(feedbackController));
router.get('/submit', isAuthenticated, feedbackController.getSubmitForm.bind(feedbackController));
router.post('/submit', isAuthenticated, feedbackController.submitFeedback.bind(feedbackController));
router.get('/:id', isAuthenticated, feedbackController.getFeedbackDetails.bind(feedbackController));

// ==================== ADMIN ROUTES ====================
// IMPORTANT: Put more specific routes BEFORE parameter routes
router.get('/admin/list', isAuthenticated, feedbackController.getAdminFeedback.bind(feedbackController));
router.get('/admin/export', isAuthenticated, feedbackController.exportFeedback.bind(feedbackController));
router.get('/admin/details/:id', isAuthenticated, feedbackController.getFeedbackForAdmin.bind(feedbackController));
router.post('/admin/:id/reply', isAuthenticated, feedbackController.replyToFeedback.bind(feedbackController));
router.put('/admin/:id/status', isAuthenticated, feedbackController.updateStatus.bind(feedbackController));
router.delete('/admin/:id', isAuthenticated, feedbackController.deleteFeedback.bind(feedbackController));

module.exports = router;