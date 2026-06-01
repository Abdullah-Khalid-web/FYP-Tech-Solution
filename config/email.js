const nodemailer = require('nodemailer');

// Configure email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Send email function
const sendEmail = async (to, subject, html) => {
  try {
    const info = await transporter.sendMail({
      from: `"ManageHub" <${process.env.SMTP_USER}>`,
      to: to,
      subject: subject,
      html: html,
    });
    return { success: true, info };
  } catch (error) {
    console.error('Email sending error:', error);
    return { success: false, error: error.message };
  }
};

// Generate reset password email HTML
const getResetPasswordEmail = (name, resetLink) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset Request</title>
      <style>
        body {
          font-family: 'Plus Jakarta Sans', Arial, sans-serif;
          background-color: #f8fafc;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .card {
          background: #ffffff;
          border-radius: 16px;
          padding: 40px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .logo {
          font-size: 28px;
          font-weight: 800;
          color: #0f172a;
          text-decoration: none;
        }
        h2 {
          color: #0f172a;
          font-size: 24px;
          margin-bottom: 16px;
        }
        .content {
          color: #334155;
          line-height: 1.6;
        }
        .button {
          display: inline-block;
          background-color: #0f172a;
          color: #ffffff !important;
          text-decoration: none;
          padding: 12px 32px;
          border-radius: 8px;
          font-weight: 600;
          margin: 24px 0;
        }
        .button:hover {
          background-color: #1e293b;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e2e8f0;
          font-size: 12px;
          color: #64748b;
        }
        .warning {
          background-color: #fef3c7;
          border-left: 4px solid #f59e0b;
          padding: 12px;
          margin: 20px 0;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div class="header">
            <div class="logo">ManageHub</div>
          </div>
          <h2>Password Reset Request</h2>
          <div class="content">
            <p>Hello ${name},</p>
            <p>We received a request to reset the password for your ManageHub account. Click the button below to create a new password:</p>
            
            <div style="text-align: center;">
              <a href="${resetLink}" class="button">Reset Password</a>
            </div>
            
            <div class="warning">
              <strong>⚠️ This link will expire in 1 hour</strong><br>
              If you didn't request this password reset, please ignore this email or contact support.
            </div>
            
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="word-break: break-all; font-size: 12px; color: #64748b;">${resetLink}</p>
          </div>
          <div class="footer">
            <p>This is an automated message, please do not reply to this email.</p>
            <p>&copy; 2026 ManageHub. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

// Generate password reset success email
const getPasswordResetSuccessEmail = (name) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Password Changed Successfully</title>
      <style>
        body {
          font-family: 'Plus Jakarta Sans', Arial, sans-serif;
          background-color: #f8fafc;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .card {
          background: #ffffff;
          border-radius: 16px;
          padding: 40px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .success-icon {
          text-align: center;
          font-size: 64px;
          margin-bottom: 20px;
        }
        h2 {
          color: #0f172a;
          text-align: center;
        }
        .content {
          color: #334155;
          line-height: 1.6;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          font-size: 12px;
          color: #64748b;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div class="success-icon">✅</div>
          <h2>Password Changed Successfully</h2>
          <div class="content">
            <p>Hello ${name},</p>
            <p>Your ManageHub account password has been successfully changed.</p>
            <p>If you did not make this change, please contact our support team immediately.</p>
            <p>You can now log in to your account with your new password.</p>
          </div>
          <div class="footer">
            <p>&copy; 2026 ManageHub. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

module.exports = {
  sendEmail,
  getResetPasswordEmail,
  getPasswordResetSuccessEmail,
};