// middlewares/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/user');

const checkForAuthenticationCookie = (cookieName) => {
  return async (req, res, next) => {
    const token = req.cookies[cookieName];
    if (!token) {
      req.user = null;
      return next();
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('fullname email role profileImageURL followers following');
      req.user = user;
      next();
    } catch (err) {
      console.error('JWT verification error:', err);
      req.user = null;
      next();
    }
  };
};

const ensureAuthenticated = (req, res, next) => {
  if (!req.user) {
    return res.redirect('/user/signin?error_msg=Please log in to access this page');
  }
  next();
};

const ensureNotAuthenticated = (req, res, next) => {
  if (req.user) {
    return res.redirect('/?error_msg=You are already logged in');
  }
  next();
};

module.exports = {
  checkForAuthenticationCookie,
  ensureAuthenticated,
  ensureNotAuthenticated
};
