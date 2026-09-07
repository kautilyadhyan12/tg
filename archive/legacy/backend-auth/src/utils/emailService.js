const nodemailer = require('nodemailer');

// Create transporter (per send — cheap, and avoids stale connections)
const createTransporter = () => {
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // TLS-from-start for 465, STARTTLS otherwise
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // A stuck SMTP server must not hold requests open indefinitely
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
};

// Send email verification link
const sendVerificationEmail = async (email, fullName, token) => {
  const base = (process.env.FRONTEND_URL || '').split(',')[0].trim();
  const verifyUrl = `${base}/verify-email?token=${token}`;
  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"AI Home Gym" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: 'Verify your AI Home Gym account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #6366f1;">Welcome to AI Home Gym, ${fullName}!</h2>
        <p>Thanks for signing up. Please verify your email address to get started.</p>
        <a href="${verifyUrl}"
           style="background: #6366f1; color: white; padding: 12px 24px;
                  text-decoration: none; border-radius: 6px; display: inline-block; margin: 16px 0;">
          Verify Email Address
        </a>
        <p style="color: #666; font-size: 14px;">
          This link expires in 24 hours. If you didn't create an account, ignore this email.
        </p>
        <p style="color: #999; font-size: 12px;">
          If the button doesn't work, copy this link: ${verifyUrl}
        </p>
      </div>
    `,
  });
};

// Send password reset link
const sendPasswordResetEmail = async (email, fullName, token) => {
  const base = (process.env.FRONTEND_URL || '').split(',')[0].trim();
  const resetUrl = `${base}/reset-password?token=${token}`;
  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"AI Home Gym" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: 'Reset your AI Home Gym password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #6366f1;">Password Reset Request</h2>
        <p>Hi ${fullName}, we received a request to reset your password.</p>
        <a href="${resetUrl}"
           style="background: #6366f1; color: white; padding: 12px 24px;
                  text-decoration: none; border-radius: 6px; display: inline-block; margin: 16px 0;">
          Reset Password
        </a>
        <p style="color: #666; font-size: 14px;">
          This link expires in 1 hour. If you didn't request a reset, ignore this email.
        </p>
        <p style="color: #999; font-size: 12px;">
          If the button doesn't work, copy this link: ${resetUrl}
        </p>
      </div>
    `,
  });
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
