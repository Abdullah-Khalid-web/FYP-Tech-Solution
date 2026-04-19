const router = require('express').Router();
const registerController = require('../controllers/registerController');

/* SHOW REGISTER FORM */
router.get('/register', registerController.showRegister);

/* HANDLE REGISTER */
router.post('/register', registerController.register);

module.exports = router;
