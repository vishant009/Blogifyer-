const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendEmail(options) {
  await transporter.sendMail({
    from: '"Blogify" <' + process.env.EMAIL_USER + '>',
    to: options.to,
    subject: options.subject,
    html: options.html
  });
}

module.exports = { sendEmail };
