const { Router } = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/user');
const { ensureAuthenticated, ensureNotAuthenticated } = require('../middlewares/auth');
const { sendEmail } = require('../middlewares/nodemailer');
const { createTokenForUser } = require('../services/authentication');
const { randomBytes } = require('crypto');
const { requestPasswordReset } = require('../services/passwordReset');

const router = Router();

// Rate limiter for signup and password reset
const signupLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many signup attempts, please try again later'
});

const forgotPasswordLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many password reset attempts, please try again later'
});

router.get('/signin', ensureNotAuthenticated, (req, res) => {
  res.render('signin', {
    title: 'Sign In',
    error_msg: null,
    success_msg: null,
    email: '',
    csrfToken: req.csrfToken()
  });
});

router.post('/signin', ensureNotAuthenticated, async (req, res) => {
  const { email, password } = req.body;
  try {
    const token = await User.matchPassword(email, password);
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/');
  } catch (err) {
    console.error('Sign-in error:', err);
    res.render('signin', {
      title: 'Sign In',
      error_msg: err.message || 'An error occurred',
      success_msg: null,
      email,
      csrfToken: req.csrfToken()
    });
  }
});

router.get('/signup', ensureNotAuthenticated, (req, res) => {
  res.render('signup', {
    title: 'Sign Up',
    error_msg: null,
    success_msg: null,
    fullname: '',
    email: '',
    csrfToken: req.csrfToken()
  });
});

router.post('/signup', signupLimiter, ensureNotAuthenticated, async (req, res) => {
  const { fullname, email, password } = req.body;
  try {
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render('signup', {
        title: 'Sign Up',
        error_msg: 'Email already exists',
        success_msg: null,
        fullname,
        email,
        csrfToken: req.csrfToken()
      });
    }
    const user = new User({
      fullname,
      email,
      password,
      isVerified: false,
      verificationCode: randomBytes(3).toString('hex').toUpperCase(),
      verificationCodeExpires: Date.now() + 3600000
    });
    await user.save();
    await sendEmail({
      to: email,
      subject: 'Blogify Email Verification',
      html: `<p>Your verification code is: ${user.verificationCode}</p>`
    });
    res.redirect(`/user/verify-email?email=${encodeURIComponent(email)}`);
  } catch (err) {
    console.error('Sign-up error:', err);
    res.render('signup', {
      title: 'Sign Up',
      error_msg: err.message || 'An error occurred',
      success_msg: null,
      fullname,
      email,
      csrfToken: req.csrfToken()
    });
  }
});

router.get('/verify-email', ensureNotAuthenticated, (req, res) => {
  res.render('verify-email', {
    title: 'Verify Email',
    email: req.query.email || '',
    error_msg: null,
    success_msg: null,
    csrfToken: req.csrfToken()
  });
});

router.post('/verify-email', ensureNotAuthenticated, async (req, res) => {
  const { email, code } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || user.verificationCode !== code || user.verificationCodeExpires < Date.now()) {
      return res.render('verify-email', {
        title: 'Verify Email',
        email,
        error_msg: 'Invalid or expired verification code',
        success_msg: null,
        csrfToken: req.csrfToken()
      });
    }
    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpires = undefined;
    await user.save();
    const token = createTokenForUser(user);
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/?success_msg=Email verified successfully');
  } catch (err) {
    console.error('Email verification error:', err);
    res.render('verify-email', {
      title: 'Verify Email',
      email,
      error_msg: 'An error occurred',
      success_msg: null,
      csrfToken: req.csrfToken()
    });
  }
});

router.post('/resend-verification', ensureNotAuthenticated, async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) throw new Error('User not found');
    if (user.isVerified) throw new Error('Email already verified');
    user.verificationCode = randomBytes(3).toString('hex').toUpperCase();
    user.verificationCodeExpires = Date.now() + 3600000;
    await user.save();
    await sendEmail({
      to: email,
      subject: 'Blogify Email Verification',
      html: `<p>Your verification code is: ${user.verificationCode}</p>`
    });
    res.redirect(`/user/verify-email?email=${encodeURIComponent(email)}&success_msg=Verification code resent`);
  } catch (err) {
    console.error('Resend verification error:', err);
    res.render('verify-email', {
      title: 'Verify Email',
      email,
      error_msg: err.message || 'An error occurred',
      success_msg: null,
      csrfToken: req.csrfToken()
    });
  }
});

router.get('/forgot-password', ensureNotAuthenticated, (req, res) => {
  res.render('forgot-password', {
    title: 'Forgot Password',
    error: null,
    success_msg: null,
    email: '',
    showPopup: false,
    userId: null,
    csrfToken: req.csrfToken()
  });
});

router.post('/forgot-password', forgotPasswordLimiter, ensureNotAuthenticated, async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.render('forgot-password', {
        title: 'Forgot Password',
        error: 'No account found with that email',
        success_msg: null,
        email,
        showPopup: false,
        userId: null,
        csrfToken: req.csrfToken()
      });
    }
    await requestPasswordReset(user, req);
    res.render('forgot-password', {
      title: 'Forgot Password',
      error: null,
      success_msg: 'Reset link sent to your email',
      email,
      showPopup: true,
      userId: user._id,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.render('forgot-password', {
      title: 'Forgot Password',
      error: 'An error occurred',
      success_msg: null,
      email,
      showPopup: false,
      userId: null,
      csrfToken: req.csrfToken()
    });
  }
});

router.get('/reset-password/:userId/:token', ensureNotAuthenticated, async (req, res) => {
  const { userId, token } = req.params;
  try {
    const user = await User.findById(userId);
    if (!user || user.resetPasswordToken !== token || user.resetPasswordExpires < Date.now()) {
      return res.redirect('/user/forgot-password?error_msg=Invalid or expired reset link');
    }
    res.render('reset-password', {
      title: 'Reset Password',
      error_msg: null,
      success_msg: null,
      userId,
      token,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    console.error('Reset password GET error:', err);
    res.redirect('/user/forgot-password?error_msg=An error occurred');
  }
});

router.post('/reset-password', ensureNotAuthenticated, async (req, res) => {
  const { userId, token, password, confirmPassword } = req.body;
  try {
    if (password.length < 8) {
      return res.render('reset-password', {
        title: 'Reset Password',
        error_msg: 'Password must be at least 8 characters',
        success_msg: null,
        userId,
        token,
        csrfToken: req.csrfToken()
      });
    }
    if (password !== confirmPassword) {
      return res.render('reset-password', {
        title: 'Reset Password',
        error_msg: 'Passwords do not match',
        success_msg: null,
        userId,
        token,
        csrfToken: req.csrfToken()
      });
    }
    const user = await User.findById(userId);
    if (!user || user.resetPasswordToken !== token || user.resetPasswordExpires < Date.now()) {
      return res.render('reset-password', {
        title: 'Reset Password',
        error_msg: 'Invalid or expired reset token',
        success_msg: null,
        userId,
        token,
        csrfToken: req.csrfToken()
      });
    }
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.render('reset-password', {
      title: 'Reset Password',
      error_msg: null,
      success_msg: 'Password reset successfully! Please sign in.',
      userId,
      token,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    console.error('Reset password POST error:', err);
    res.render('reset-password', {
      title: 'Reset Password',
      error_msg: 'An error occurred',
      success_msg: null,
      userId,
      token,
      csrfToken: req.csrfToken()
    });
  }
});

router.get('/logout', ensureAuthenticated, (req, res) => {
  res.clearCookie('token');
  res.redirect('/user/signin?success_msg=Logged out successfully');
});

router.post('/follow/:userId', ensureAuthenticated, async (req, res) => {
  try {
    const userToFollow = await User.findById(req.params.userId);
    const currentUser = await User.findById(req.user._id);
    if (!userToFollow || !currentUser || userToFollow._id.equals(currentUser._id)) {
      return res.redirect('back');
    }
    if (!userToFollow.followers.includes(currentUser._id)) {
      userToFollow.followers.push(currentUser._id);
      currentUser.following.push(userToFollow._id);
      await userToFollow.save();
      await currentUser.save();
    }
    res.redirect('back');
  } catch (err) {
    console.error('Follow user error:', err);
    res.redirect('back');
  }
});

router.post('/unfollow/:userId', ensureAuthenticated, async (req, res) => {
  try {
    const userToUnfollow = await User.findById(req.params.userId);
    const currentUser = await User.findById(req.user._id);
    if (!userToUnfollow || !currentUser) {
      return res.redirect('back');
    }
    userToUnfollow.followers.pull(currentUser._id);
    currentUser.following.pull(userToUnfollow._id);
    await userToUnfollow.save();
    await currentUser.save();
    res.redirect('back');
  } catch (err) {
    console.error('Unfollow user error:', err);
    res.redirect('back');
  }
});

module.exports = router;
