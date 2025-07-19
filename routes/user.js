// routes/user.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User'); // Adjust path to your User model
const { ensureAuthenticated, ensureNotAuthenticated } = require('../middleware/auth'); // Adjust path to your auth middleware
const { sendResetPasswordEmail } = require('../utils/email'); // Adjust path to your email utility
const crypto = require('crypto');

// GET: Render sign-in page
router.get('/signin', ensureNotAuthenticated, (req, res) => {
  res.render('signin', {
    title: 'Sign In',
    error_msg: null,
    success_msg: null,
    email: '',
    csrfToken: req.csrfToken()
  });
});

// POST: Handle sign-in
router.post('/signin', ensureNotAuthenticated, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.render('signin', {
        title: 'Sign In',
        error_msg: 'Invalid email or password',
        success_msg: null,
        email,
        csrfToken: req.csrfToken()
      });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('signin', {
        title: 'Sign In',
        error_msg: 'Invalid email or password',
        success_msg: null,
        email,
        csrfToken: req.csrfToken()
      });
    }
    req.session.userId = user._id;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('signin', {
      title: 'Sign In',
      error_msg: 'An error occurred',
      success_msg: null,
      email,
      csrfToken: req.csrfToken()
    });
  }
});

// GET: Render sign-up page
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

// POST: Handle sign-up
router.post('/signup', ensureNotAuthenticated, async (req, res) => {
  const { fullname, email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.render('signup', {
        title: 'Sign Up',
        error_msg: 'Email already exists',
        success_msg: null,
        fullname,
        email,
        csrfToken: req.csrfToken()
      });
    }
    user = new User({
      fullname,
      email,
      password: await bcrypt.hash(password, 10)
    });
    await user.save();
    req.session.userId = user._id;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('signup', {
      title: 'Sign Up',
      error_msg: 'An error occurred',
      success_msg: null,
      fullname,
      email,
      csrfToken: req.csrfToken()
    });
  }
});

// GET: Render forgot password page
router.get('/forgot-password', ensureNotAuthenticated, (req, res) => {
  res.render('forgot-password', {
    title: 'Forgot Password',
    error: null,
    success_msg: null,
    email: '',
    showPopup: false,
    userId: null,
    csrfToken: req.csrfToken() // Fixed: Use function call
  });
});

// POST: Handle forgot password
router.post('/forgot-password', ensureNotAuthenticated, async (req, res) => {
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
    const resetCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    user.resetPasswordCode = resetCode;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();
    await sendResetPasswordEmail(user.email, resetCode);
    res.render('forgot-password', {
      title: 'Forgot Password',
      error: null,
      success_msg: 'Reset code sent to your email',
      email,
      showPopup: true,
      userId: user._id,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    console.error(err);
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

// POST: Verify reset code
router.post('/verify-reset-code/:userId', ensureNotAuthenticated, async (req, res) => {
  const { userId } = req.params;
  const { code } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user || user.resetPasswordCode !== code || user.resetPasswordExpires < Date.now()) {
      return res.render('forgot-password', {
        title: 'Forgot Password',
        error: 'Invalid or expired reset code',
        success_msg: null,
        email: user?.email || '',
        showPopup: true,
        userId,
        csrfToken: req.csrfToken()
      });
    }
    res.redirect(`/user/reset-password/${userId}/${code}`);
  } catch (err) {
    console.error(err);
    res.render('forgot-password', {
      title: 'Forgot Password',
      error: 'An error occurred',
      success_msg: null,
      email: '',
      showPopup: true,
      userId,
      csrfToken: req.csrfToken()
    });
  }
});

// GET: Render reset password page
router.get('/reset-password/:userId/:code', ensureNotAuthenticated, async (req, res) => {
  const { userId, code } = req.params;
  try {
    const user = await User.findById(userId);
    if (!user || user.resetPasswordCode !== code || user.resetPasswordExpires < Date.now()) {
      return res.redirect('/user/forgot-password');
    }
    res.render('reset-password', {
      title: 'Reset Password',
      error_msg: null,
      success_msg: null,
      userId,
      token: code,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    console.error(err);
    res.redirect('/user/forgot-password');
  }
});

// POST: Handle reset password
router.post('/reset-password', ensureNotAuthenticated, async (req, res) => {
  const { userId, token, password } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user || user.resetPasswordCode !== token || user.resetPasswordExpires < Date.now()) {
      return res.render('reset-password', {
        title: 'Reset Password',
        error_msg: 'Invalid or expired reset token',
        success_msg: null,
        userId,
        token,
        csrfToken: req.csrfToken()
      });
    }
    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordCode = undefined;
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
    console.error(err);
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

// GET: Handle logout
router.get('/logout', ensureAuthenticated, (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error(err);
      return res.redirect('/');
    }
    res.redirect('/user/signin');
  });
});

// GET: Follow user
router.post('/follow/:userId', ensureAuthenticated, async (req, res) => {
  try {
    const userToFollow = await User.findById(req.params.userId);
    const currentUser = await User.findById(req.session.userId);
    if (!userToFollow || !currentUser) {
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
    console.error(err);
    res.redirect('back');
  }
});

// GET: Unfollow user
router.post('/unfollow/:userId', ensureAuthenticated, async (req, res) => {
  try {
    const userToUnfollow = await User.findById(req.params.userId);
    const currentUser = await User.findById(req.session.userId);
    if (!userToUnfollow || !currentUser) {
      return res.redirect('back');
    }
    userToUnfollow.followers.pull(currentUser._id);
    currentUser.following.pull(userToUnfollow._id);
    await userToUnfollow.save();
    await currentUser.save();
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

module.exports = router;
