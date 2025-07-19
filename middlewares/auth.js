const jwt = require('jsonwebtoken');

function checkForAuthenticationCookie(cookieName) {
  return (req, res, next) => {
    const token = req.cookies[cookieName];
    if (!token) return next();
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      req.user = user;
      next();
    } catch (err) {
      console.error('Token verification failed:', err);
      next();
    }
  };
}

function ensureAuthenticated(req, res, next) {
  if (!req.user) {
    return res.redirect('/user/signin?error_msg=Please log in');
  }
  next();
}

function ensureNotAuthenticated(req, res, next) {
  if (req.user) {
    return res.redirect('/?error_msg=You are already logged in');
  }
  next();
}

module.exports = { checkForAuthenticationCookie, ensureAuthenticated, ensureNotAuthenticated };
