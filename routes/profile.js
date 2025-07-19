const { Router } = require('express');
const User = require('../models/user');
const Blog = require('../models/blog');
const cloudinaryUpload = require('../middlewares/cloudinaryUpload');
const { createTokenForUser } = require('../services/authentication');
const mongoose = require('mongoose');

const router = Router();

const renderProfile = (res, user, profileUser, blogs, isFollowing = false, messages = {}) => {
  return res.render('profile', {
    user: user || null,
    profileUser,
    blogs: blogs || [],
    isFollowing,
    success_msg: messages.success_msg || null,
    error_msg: messages.error_msg || null,
    csrfToken: res.csrfToken()
  });
};

router.get('/', async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect('/user/signin?error_msg=Please log in to view your profile');
    }
    const profileUser = await User.findById(req.user._id)
      .populate('following', 'fullname profileImageURL')
      .populate('followers', 'fullname profileImageURL')
      .populate({ path: 'likedBlogs', populate: { path: 'createdBy', select: 'fullname profileImageURL' } });
    const blogs = await Blog.find({ createdBy: req.user._id, status: 'published' })
      .populate('createdBy', 'fullname profileImageURL')
      .populate('likes', 'fullname profileImageURL')
      .sort({ createdAt: -1 });
    renderProfile(res, req.user, profileUser, blogs, false, {
      success_msg: req.query.success_msg,
      error_msg: req.query.error_msg
    });
  } catch (err) {
    console.error('Error loading profile:', err);
    renderProfile(res, req.user, null, [], false, { error_msg: 'Failed to load profile' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return renderProfile(res, req.user, null, [], false, { error_msg: 'Invalid user ID' });
    }
    const profileUser = await User.findById(req.params.id)
      .populate('following', 'fullname profileImageURL')
      .populate('followers', 'fullname profileImageURL')
      .populate({ path: 'likedBlogs', populate: { path: 'createdBy', select: 'fullname profileImageURL' } });
    if (!profileUser) {
      return renderProfile(res, req.user, null, [], false, { error_msg: 'User not found' });
    }
    if (
      profileUser.profileVisibility === 'private' &&
      (!req.user || req.user._id.toString() !== req.params.id)
    ) {
      return renderProfile(res, req.user, null, [], false, { error_msg: 'This profile is private' });
    }
    if (profileUser.profileVisibility === 'followers' && req.user) {
      const isFollower = profileUser.followers.some((f) => f._id.equals(req.user._id));
      if (!isFollower && req.user._id.toString() !== req.params.id) {
        return renderProfile(res, req.user, null, [], false, {
          error_msg: 'You must follow this user to view their profile'
        });
      }
    }
    const blogs = await Blog.find({ createdBy: req.params.id, status: 'published' })
      .populate('createdBy', 'fullname profileImageURL')
      .populate('likes', 'fullname profileImageURL')
      .sort({ createdAt: -1 });
    const isFollowing = req.user
      ? profileUser.followers.some((follower) => follower._id.equals(req.user._id))
      : false;
    renderProfile(res, req.user, profileUser, blogs, isFollowing, {
      success_msg: req.query.success_msg,
      error_msg: req.query.error_msg
    });
  } catch (err) {
    console.error('Error loading profile for ID:', req.params.id, err);
    renderProfile(res, req.user, null, [], false, { error_msg: 'Failed to load profile' });
  }
});

router.post('/', cloudinaryUpload.single('profileImage'), async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect('/user/signin?error_msg=Please log in to update your profile');
    }
    const { fullname, email, password, bio, visibility } = req.body;
    const update = {};
    if (fullname?.trim()) {
      if (fullname.trim().length < 2) {
        return res.redirect('/profile?error_msg=Full name must be at least 2 characters');
      }
      update.fullname = fullname.trim();
    }
    if (email?.trim()) {
      const e = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        return res.redirect('/profile?error_msg=Invalid email format');
      }
      const exists = await User.findOne({ email: e, _id: { $ne: req.user._id } });
      if (exists) return res.redirect('/profile?error_msg=Email already in use');
      update.email = e;
    }
    if (password) {
      if (password.length < 8) {
        return res.redirect('/profile?error_msg=Password must be at least 8 characters');
      }
      update.password = password;
    }
    if (req.file) update.profileImageURL = req.file.path;
    if (bio?.trim()) update.bio = bio.trim();
    if (visibility && ['public', 'followers', 'private'].includes(visibility)) {
      update.profileVisibility = visibility;
    }
    if (!Object.keys(update).length) {
      return res.redirect('/profile?error_msg=No changes provided');
    }
    const updatedUser = await User.findByIdAndUpdate(req.user._id, update, { new: true });
    if (!updatedUser) return res.redirect('/profile?error_msg=User not found');
    const token = createTokenForUser(updatedUser);
    res.cookie('token', token, { httpOnly: true });
    return res.redirect('/profile?success_msg=Profile updated successfully');
  } catch (err) {
    console.error('Error updating profile:', err);
    return res.redirect('/profile?error_msg=Failed to update profile');
  }
});

module.exports = router;
