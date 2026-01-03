const router = require('express').Router();
const authController = require('../controllers/authController');

/* LOGIN */
router.get('/login', authController.showLogin);
router.post('/login', authController.login);

/* LOGOUT */
router.get('/logout', authController.showLogout);
router.post('/logout', authController.logout);

module.exports = router;
