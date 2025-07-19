// middlewares/nodemailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendEmail = async (options) => {
  try {
    await transporter.sendMail(options);
    console.log(`Email sent to ${options.to}`);
  } catch (err) {
    console.error('Error sending email:', err);
    throw err;
  }
};

module.exports = { sendEmail };
