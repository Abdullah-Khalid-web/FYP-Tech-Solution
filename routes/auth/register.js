const express = require('express');
const router = express.Router();
const registerController = require('../../controllers/registerController');
const multer = require('multer');

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}.${ext}`);
  }
});
const upload = multer({ storage });

router.get('/register', registerController.showRegister);
router.post('/register', upload.single('logo'), registerController.register);

module.exports = router;
