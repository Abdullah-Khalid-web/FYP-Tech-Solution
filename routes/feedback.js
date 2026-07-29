const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const { isAuthenticated } = require('../middleware/auth');
const { requirePermissionOrAdmin } = require('../middleware/roleAuth');

// Apply shop info middleware to all routes
router.use(feedbackController.getShopInfo.bind(feedbackController));

// ==================== USER ROUTES ====================
// Any authenticated user can submit/view their own feedback -- not permission-gated.
router.get('/', isAuthenticated, feedbackController.getUserFeedback.bind(feedbackController));
router.get('/submit', isAuthenticated, feedbackController.getSubmitForm.bind(feedbackController));
router.post('/submit', isAuthenticated, feedbackController.submitFeedback.bind(feedbackController));
router.get('/:id', isAuthenticated, feedbackController.getFeedbackDetails.bind(feedbackController));
router.post('/:id/resolve', isAuthenticated, feedbackController.resolveOwnFeedback.bind(feedbackController));
router.post('/:id/delete', isAuthenticated, feedbackController.deleteOwnFeedback.bind(feedbackController));

// ==================== ADMIN ROUTES ====================
// Viewing/managing everyone's feedback requires the granular feedback.* permission.
// IMPORTANT: Put more specific routes BEFORE parameter routes
router.get('/admin/list', isAuthenticated, requirePermissionOrAdmin('feedback.view'), feedbackController.getAdminFeedback.bind(feedbackController));
router.get('/admin/export', isAuthenticated, requirePermissionOrAdmin('feedback.reports'), feedbackController.exportFeedback.bind(feedbackController));
router.get('/admin/details/:id', isAuthenticated, requirePermissionOrAdmin('feedback.view'), feedbackController.getFeedbackForAdmin.bind(feedbackController));
router.post('/admin/:id/reply', isAuthenticated, requirePermissionOrAdmin('feedback.respond'), feedbackController.replyToFeedback.bind(feedbackController));
router.put('/admin/:id/status', isAuthenticated, requirePermissionOrAdmin('feedback.manage'), feedbackController.updateStatus.bind(feedbackController));
router.delete('/admin/:id', isAuthenticated, requirePermissionOrAdmin('feedback.manage'), feedbackController.deleteFeedback.bind(feedbackController));

module.exports = router;