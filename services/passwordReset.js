const { randomBytes } = require('crypto');
const { sendEmail } = require('../middlewares/nodemailer');

async function requestPasswordReset(user, req) {
  const resetToken = randomBytes(32).toString('hex');
  user.resetPasswordToken = resetToken;
  user.resetPasswordExpires = Date.now() + 3600000;
  await user.save();
  const resetUrl = `http://${req.headers.host}/settings/reset-password/${user._id}/${resetToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Blogify Password Reset',
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`
  });
  return resetUrl;
}

module.exports = { requestPasswordReset };
