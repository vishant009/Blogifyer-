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

    const { subscription, userId } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth || !userId) {
      console.error("Invalid subscription data:", subscription);
      return res.status(400).json({ error: "Invalid subscription data" });
    }

    const updatedSubscription = await PushNotification.findOneAndUpdate(
      { userId },
      { subscription, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    console.log(`User ${userId} subscribed to push notifications`);

    const payload = {
      title: "Welcome to Blogify Notifications",
      body: "You have successfully subscribed to push notifications!",
      url: "/notification",
    };
    await webpush.sendNotification(subscription, JSON.stringify(payload)).catch((err) => {
      console.error("Test notification failed:", err);
    });

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
    if (!subscriptionDoc) {
      console.warn(`No subscription found for user ${userId}`);
      return;
    }

    await webpush.sendNotification(subscriptionDoc.subscription, JSON.stringify(payload));
    console.log(`Push notification sent to user ${userId}`);
  } catch (err) {
    console.error(`Error sending push notification to user ${userId}:`, err);
    if (err.statusCode === 410 || err.statusCode === 404) {
      console.log(`Removing invalid subscription for user ${userId}`);
      await PushNotification.deleteOne({ userId });
    }
  }
};

// POST /notificationPush/trigger
router.post("/trigger", async (req, res) => {
  try {
    const { action, blogId, commentId, senderId, recipientId } = req.body;
    if (!action || !senderId) {
      return res.status(400).json({ error: "Missing required fields: action or senderId" });
    }

    const sender = await User.findById(senderId);
    if (!sender) {
      return res.status(404).json({ error: "Sender not found" });
    }

    let payload = {};
    let recipientUserId;

    switch (action) {
      case "NEW_BLOG":
        const blog = await Blog.findById(blogId).populate("createdBy");
        if (!blog) return res.status(404).json({ error: "Blog not found" });

        const followers = await User.find({ _id: { $in: blog.createdBy.followers } });
        payload = {
          title: "New Blog Post",
          body: `${blog.createdBy.fullname} posted: ${blog.title}`,
          url: `/blog/${blog._id}`,
          image: blog.coverImage || "/images/default.png",
          timestamp: blog.createdAt.toISOString(),
        };

        for (const follower of followers) {
          await sendPushNotification(follower._id, payload);
          await Notification.create({
            recipient: follower._id,
            sender: blog.createdBy._id,
            type: "NEW_BLOG",
            blogId: blog._id,
            message: `${blog.createdBy.fullname} posted: ${blog.title}`,
            coverImage: blog.coverImage || "/images/default.png",
            status: "PENDING",
            isRead: false,
          });
        }
        break;

      case "LIKE_BLOG":
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
          image: likedBlog.coverImage || "/images/default.png",
          timestamp: new Date().toISOString(),
        };
        await sendPushNotification(recipientUserId, payload);
        await Notification.create({
          recipient: recipientUserId,
          sender: senderId,
          type: "LIKE",
          blogId,
          message: `${sender.fullname} liked your blog: ${likedBlog.title}`,
          coverImage: likedBlog.coverImage || "/images/default.png",
          status: "PENDING",
          isRead: false,
        });
        break;

      case "NEW_COMMENT":
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
          image: comment.blogId.coverImage || "/images/default.png",
          timestamp: new Date().toISOString(),
        };
        await sendPushNotification(recipientUserId, payload);
        await Notification.create({
          recipient: recipientUserId,
          sender: senderId,
          type: "NEW_COMMENT",
          blogId: comment.blogId._id,
          message: `${sender.fullname} commented on your blog: ${comment.blogId.title}`,
          coverImage: comment.blogId.coverImage || "/images/default.png",
          status: "PENDING",
          isRead: false,
        });
        break;

      case "LIKE_COMMENT":
        const likedComment = await Comment.findById(commentId).populate("createdBy").populate("blogId");
        if (!likedComment || !likedComment.blogId) return res.status(404).json({ error: "Comment or blog not found" });

        recipientUserId = likedComment.createdBy._id;
        if (recipientUserId.toString() === senderId.toString()) {
          return res.status(400).json({ error: "Cannot notify yourself" });
        }

        payload = {
          title: "Comment Liked",
          body: `${sender.fullname} liked your comment on: ${likedComment.blogId.title}`,
          url: `/blog/${likedComment.blogId._id}`,
          image: likedComment.blogId.coverImage || "/images/default.png",
          timestamp: new Date().toISOString(),
        };
        await sendPushNotification(recipientUserId, payload);
        await Notification.create({
          recipient: recipientUserId,
          sender: senderId,
          type: "LIKE_COMMENT",
          blogId: likedComment.blogId,
          message: `${sender.fullname} liked your comment on: ${likedComment.blogId.title}`,
          coverImage: likedComment.blogId.coverImage || "/images/default.png",
          status: "PENDING",
          isRead: false,
        });
        break;

      case "FOLLOW_REQUEST":
        const recipient = await User.findById(recipientId);
        if (!recipient) return res.status(404).json({ error: "Recipient not found" });

        if (recipientId.toString() === senderId.toString()) {
          return res.status(400).json({ error: "Cannot send follow request to yourself" });
        }

        payload = {
          title: "New Follow Request",
          body: `${sender.fullname} wants to follow you`,
          url: `/notification`,
          timestamp: new Date().toISOString(),
        };
        await sendPushNotification(recipientId, payload);
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
