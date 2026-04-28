const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const bcrypt = require('bcryptjs');
<<<<<<< HEAD
const registerController = require('../../controllers/authController');

=======
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96

function binToUuid(buffer) {
  if (!buffer) return null;
  const hex = buffer.toString('hex');
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32)
  ].join('-');
}

router.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.render('auth/login', { title: 'Login', error: null });
});

router.post('/login', async (req, res) => {
<<<<<<< HEAD
  const { name, password } = req.body;
  if (!name || !password) {
    return res.render('auth/login', { title: 'Login', error: 'Username and password are required' });
  }

  try {
    const [users] = await pool.execute('SELECT * FROM users WHERE name = ? LIMIT 1', [name]);
    if (!users.length) return res.render('auth/login', { title: 'Login', error: 'Invalid credentials' });

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.render('auth/login', { title: 'Login', error: 'Invalid credentials' });

    // Convert BINARY(16) to UUID string before storing in session
    req.session.userId = binToUuid(user.id);
    req.session.shopId = user.shop_id ? binToUuid(user.shop_id) : null;
    req.session.username = user.name;

    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { title: 'Login', error: 'Login failed' });
  }
});

module.exports = router;
=======
  console.log('Login attempt - req.body:', req.body); // Debug log
  
  const { email, password } = req.body; // Changed from 'name' to 'email'
  
  if (!email || !password) {
    return res.render('auth/login', { 
      title: 'Login', 
      error: 'Email and password are required' 
    });
  }

  try {
    // Changed from 'name' to 'email' in query
    const [users] = await pool.execute(
      'SELECT id, name, email, password, shop_id FROM users WHERE email = ? LIMIT 1', 
      [email]
    );
    
    if (!users.length) {
      return res.render('auth/login', { 
        title: 'Login', 
        error: 'Invalid email or password' 
      });
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password);
    
    if (!valid) {
      return res.render('auth/login', { 
        title: 'Login', 
        error: 'Invalid email or password' 
      });
    }

    // Store in session
    req.session.userId = binToUuid(user.id);
    req.session.shopId = user.shop_id ? binToUuid(user.shop_id) : null;
    req.session.username = user.name;
    req.session.userEmail = user.email; // Store email too

    // Handle "remember me" if checkbox exists
    if (req.body.rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    console.log('Login successful for:', user.email);
    res.redirect('/dashboard'); // Make sure this route exists
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { 
      title: 'Login', 
      error: 'Login failed. Please try again.' 
    });
  }
});

module.exports = router;
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
