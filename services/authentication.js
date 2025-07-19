const jwt = require('jsonwebtoken');

function createTokenForUser(user) {
  const payload = {
    _id: user._id,
    email: user.email,
    fullname: user.fullname,
    role: user.role
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
}

module.exports = { createTokenForUser };
