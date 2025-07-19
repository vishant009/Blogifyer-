const { Schema, model, models } = require('mongoose');
const bcrypt = require('bcryptjs');
const { createTokenForUser } = require('../services/authentication');

const userSchema = new Schema(
  {
    fullname: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    profileImageURL: { type: String, default: '/images/default.png' },
    role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER' },
    following: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    followers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    likedBlogs: [{ type: Schema.Types.ObjectId, ref: 'Blog' }],
    bio: { type: String, trim: true },
    isVerified: { type: Boolean, default: false },
    verificationCode: { type: String },
    verificationToken: { type: String },
    verificationCodeExpires: { type: Date },
    resetPasswordToken: { type: String },
    resetPasswordCode: { type: String },
    resetPasswordExpires: { type: Date },
    profileVisibility: { type: String, enum: ['public', 'followers', 'private'], default: 'public' }
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.statics.matchPassword = async function (email, password) {
  const user = await this.findOne({ email });
  if (!user) throw new Error('User not found');
  if (!user.isVerified) throw new Error('Please verify your email before signing in');
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new Error('Incorrect password');
  return createTokenForUser(user);
};

const User = models.User || model('User', userSchema);
module.exports = User;
