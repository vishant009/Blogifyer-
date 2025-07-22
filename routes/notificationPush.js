const { Router } = require("express");
const webpush = require("web-push");
const PushNotification = require("../models/notificationPush");
const Notification = require("../models/notification");
const User = require("../models/user");
const Blog = require("../models/blog");
const Comment = require("../models/comments");

const router = Router();

// Initialize VAPID keys
webpush.setVapidDetails(
  "mailto:blogifyer@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// POST /notificationPush/subscribe
router.post("/subscribe", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Please log in to subscribe to notifications" });
    }

    const subscription = req.body.subscription;
    if (!subscription || !subscription.endpoint || !subscription.keys.p256dh || !subscription.keys.auth) {
      return res.status(400).json({ error: "Invalid subscription data" });
    }

    // Save or update subscription
    await PushNotification.findOneAndUpdate(
      { userId: req.user._id },
      { subscription },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true, message: "Subscribed to push notifications" });
  } catch (err) {
    console.error("Error subscribing to push notifications:", err);
    return res.status(500).json({ error: "Failed to subscribe to push notifications" });
  }
});

// Utility function to send push notification
const sendPushNotification = async (userId, payload) => {
  try {
    const subscriptionDoc = await PushNotification.findOne({ userId });
    if (!subscriptionDoc) return;

    await webpush.sendNotification(subscriptionDoc.subscription, JSON.stringify(payload));
  } catch (err) {
    console.error("Error sending push notification:", err);
    // Remove invalid subscription
    if (err.statusCode === 410 || err.statusCode === 404) {
      await PushNotification.deleteOne({ userId });
    }
  }
};

// POST /notificationPush/trigger
router.post("/trigger", async (req, res) => {
  try {
    const { action, blogId, commentId, senderId, recipientId } = req.body;
    const sender = await User.findById(senderId);
    if (!sender) return res.status(404).json({ error: "Sender not found" });

    let payload = {};
    let recipientUserId;

    switch (action) {
      case "NEW_BLOG":
        // Logic 1: Notify followers when a user posts a blog
        const blog = await Blog.findById(blogId).populate("createdBy");
        if (!blog) return res.status(404).json({ error: "Blog not found" });

        const followers = await User.find({ _id: { $in: blog.createdBy.followers } });
        payload = {
          title: "New Blog Post",
          body: `${blog.createdBy.fullname} posted: ${blog.title}`,
          url: `/blog/${blog._id}`,
        };

        for (const follower of followers) {
          await sendPushNotification(follower._id, payload);
          await Notification.create({
            recipient: follower._id,
            sender: blog.createdBy._id,
            type: "NEW_BLOG",
            blogId: blog._id,
            message: `${blog.createdBy.fullname} posted: ${blog.title}`,
            status: "PENDING",
          });
        }
        break;

      case "LIKE_BLOG":
        // Logic 2: Notify blog owner when someone likes their blog
        const likedBlog = await Blog.findById(blogId).populate("createdBy");
        if (!likedBlog) return res.status(404).json({ error: "Blog not found" });

        recipientUserId = likedBlog.createdBy._id;
        if (recipientUserId.toString() === senderId.toString()) {
          return res.status(400).json({ error: "Cannot notify yourself" });
        }

        payload = {
          title: "Blog Liked",
          body: `${sender.fullname} liked your blog: ${likedBlog.title}`,
          url: `/blog/${blogId}`,
        };
        await sendPushNotification(recipientUserId, payload);
        await Notification.create({
          recipient: recipientUserId,
          sender: senderId,
          type: "LIKE",
          blogId,
          message: `${sender.fullname} liked your blog: ${likedBlog.title}`,
          status: "PENDING",
        });
        break;

      case "NEW_COMMENT":
        // Logic 3: Notify blog owner when someone comments on their blog
        const comment = await Comment.findById(commentId).populate("blogId");
        if (!comment || !comment.blogId) return res.status(404).json({ error: "Comment or blog not found" });

        recipientUserId = comment.blogId.createdBy;
        if (recipientUserId.toString() === senderId.toString()) {
          return res.status(400).json({ error: "Cannot notify yourself" });
        }

        payload = {
          title: "New Comment",
          body: `${sender.fullname} commented on your blog: ${comment.blogId.title}`,
          url: `/blog/${comment.blogId._id}`,
        };
        await sendPushNotification(recipientUserId, payload);
        await Notification.create({
          recipient: recipientUserId,
          sender: senderId,
          type: "NEW_COMMENT",
          blogId: comment.blogId._id,
          message: `${sender.fullname} commented on your blog: ${comment.blogId.title}`,
          status: "PENDING",
        });
        break;

      case "LIKE_COMMENT":
        // Logic 4: Notify comment owner when someone likes their comment
        const likedComment = await Comment.findById(commentId).populate("createdBy");
        if (!likedComment) return res.status(404).json({ error: "Comment not found" });

        recipientUserId = likedComment.createdBy._id;
        if (recipientUserId.toString() === senderId.toString()) {
          return res.status(400).json({ error: "Cannot notify yourself" });
        }

        const blogForComment = await Blog.findById(likedComment.blogId);
        payload = {
          title: "Comment Liked",
          body: `${sender.fullname} liked your comment on: ${blogForComment.title}`,
          url: `/blog/${blogForComment._id}`,
        };
        await sendPushNotification(recipientUserId, payload);
        await Notification.create({
          recipient: recipientUserId,
          sender: senderId,
          type: "LIKE_COMMENT",
          blogId: likedComment.blogId,
          message: `${sender.fullname} liked your comment on: ${blogForComment.title}`,
          status: "PENDING",
        });
        break;

      default:
        return res.status(400).json({ error: "Invalid action" });
    }

    return res.status(200).json({ success: true, message: "Notifications sent" });
  } catch (err) {
    console.error("Error triggering notification:", err);
    return res.status(500).json({ error: "Failed to trigger notification" });
  }
});

module.exports = router;
