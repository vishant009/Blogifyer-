// services/authentication.js
const jwt = require('jsonwebtoken');

const createTokenForUser = (user) => {
  const payload = {
    userId: user._id,
    email: user.email,
    role: user.role
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
};

module.exports = { createTokenForUser };
