const { Router } = require('express');
const Notification = require('../models/notification');
const User = require('../models/user');
const { ensureAuthenticated } = require('../middlewares/auth');

const router = Router();

// Get all notifications for the logged-in user
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id })
      .populate('sender', 'fullname profileImageURL')
      .sort({ createdAt: -1 });
    res.render('notifications', {
      user: req.user,
      notifications,
      error_msg: req.query.error_msg || null,
      success_msg: req.query.success_msg || null,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.redirect('/?error_msg=Failed to load notifications');
  }
});

// Mark a notification as read
router.post('/read/:id', ensureAuthenticated, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user._id
    });
    if (!notification) {
      return res.redirect('/notification?error_msg=Notification not found');
    }
    notification.status = 'READ';
    await notification.save();
    res.redirect('/notification?success_msg=Notification marked as read');
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.redirect('/notification?error_msg=Failed to mark notification as read');
  }
});

// Accept a follow request
router.post('/accept/:id', ensureAuthenticated, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user._id,
      type: 'FOLLOW_REQUEST',
      status: 'PENDING'
    });
    if (!notification) {
      return res.redirect('/notification?error_msg=Follow request not found');
    }
    const sender = await User.findById(notification.sender);
    const recipient = await User.findById(req.user._id);
    if (!sender || !recipient) {
      return res.redirect('/notification?error_msg=User not found');
    }
    if (!recipient.followers.includes(sender._id)) {
      recipient.followers.push(sender._id);
      sender.following.push(recipient._id);
      await Promise.all([recipient.save(), sender.save()]);
    }
    notification.status = 'ACCEPTED';
    await notification.save();
    res.redirect('/notification?success_msg=Follow request accepted');
  } catch (err) {
    console.error('Error accepting follow request:', err);
    res.redirect('/notification?error_msg=Failed to accept follow request');
  }
});

// Reject a follow request
router.post('/reject/:id', ensureAuthenticated, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user._id,
      type: 'FOLLOW_REQUEST',
      status: 'PENDING'
    });
    if (!notification) {
      return res.redirect('/notification?error_msg=Follow request not found');
    }
    notification.status = 'REJECTED';
    await notification.save();
    res.redirect('/notification?success_msg=Follow request rejected');
  } catch (err) {
    console.error('Error rejecting follow request:', err);
    res.redirect('/notification?error_msg=Failed to reject follow request');
  }
});

module.exports = router;
