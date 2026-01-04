
const express = require('express');
const router = express.Router();
const registerController = require('../../controllers/authController');

router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error(err);
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;
