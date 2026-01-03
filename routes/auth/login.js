const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const bcrypt = require('bcryptjs');

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('auth/login', { title: 'Login', error: null });
});

router.post('/login', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.render('auth/login', { title: 'Login', error: 'Username and password are required' });

  try {
    const [users] = await pool.execute('SELECT * FROM users WHERE name = ?', [name]);
    if (users.length !== 1) return res.render('auth/login', { title: 'Login', error: 'Invalid credentials' });

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.render('auth/login', { title: 'Login', error: 'Invalid credentials' });

    req.session.regenerate(err => {
      if (err) throw err;
      req.session.userId = user.id;
      req.session.username = user.name;
      req.session.shopId = user.shop_id;
      res.redirect('/');
    });
  } catch (err) {
    console.error(err);
    res.render('auth/login', { title: 'Login', error: 'Login failed' });
  }
});

module.exports = router;
