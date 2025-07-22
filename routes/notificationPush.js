// routes/notificationPush.js
const { Router } = require("express");
const webpush      = require("web-push");
const PushSub      = require("../models/notificationPush");
const Notification = require("../models/notification");
const User         = require("../models/user");
const Blog         = require("../models/blog");
const Comment      = require("../models/comments");

const router = Router();

// 1️⃣  Initialise web-push
webpush.setVapidDetails(
  "mailto:blogifyer@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// 2️⃣  Save / update subscription
router.post("/subscribe", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Login required" });

    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: "Bad subscription" });

    await PushSub.findOneAndUpdate(
      { userId: req.user._id },
      { subscription },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (e) {
    console.error("subscribe error", e);
    res.status(500).json({ error: "Subscribe failed" });
  }
});

// 3️⃣  Generic trigger endpoint
router.post("/trigger", async (req, res) => {
  try {
    const { action, blogId, commentId, senderId, recipientId } = req.body;
    const sender = await User.findById(senderId);
    if (!sender) return res.status(404).json({ error: "Sender not found" });

    let payload, recipientIds = [];

    switch (action) {
      case "NEW_BLOG": {
        const blog = await Blog.findById(blogId).populate("createdBy");
        if (!blog) return res.status(404).json({ error: "Blog not found" });

        const followers = await User.find({ _id: { $in: blog.createdBy.followers } });
        payload = {
          title: "New Blog Post",
          body:  `${blog.createdBy.fullname} posted: ${blog.title}`,
          url:   `/blog/${blog._id}`
        };
        recipientIds = followers.map(f => f._id);

        await Notification.insertMany(
          recipientIds.map(id => ({
            recipient: id,
            sender: blog.createdBy._id,
            type: "NEW_BLOG",
            blogId: blog._id,
            message: payload.body
          }))
        );
        break;
      }

      case "LIKE_BLOG": {
        const blog = await Blog.findById(blogId).populate("createdBy");
        if (!blog || senderId === blog.createdBy._id.toString()) return res.status(400).json({});

        payload = {
          title: "Blog Liked",
          body:  `${sender.fullname} liked: ${blog.title}`,
          url:   `/blog/${blogId}`
        };
        recipientIds = [blog.createdBy._id];

        await Notification.create({
          recipient: blog.createdBy._id,
          sender: senderId,
          type: "LIKE",
          blogId,
          message: payload.body
        });
        break;
      }

      case "NEW_COMMENT": {
        const comment = await Comment.findById(commentId).populate("blogId");
        if (!comment) return res.status(404).json({ error: "Comment not found" });
        const blog = await Blog.findById(comment.blogId);
        if (!blog) return res.status(404).json({ error: "Blog not found" });
        if (senderId === blog.createdBy.toString()) return res.status(400).json({});

        payload = {
          title: "New Comment",
          body:  `${sender.fullname} commented on: ${blog.title}`,
          url:   `/blog/${comment.blogId}`
        };
        recipientIds = [blog.createdBy];

        await Notification.create({
          recipient: blog.createdBy,
          sender: senderId,
          type: "NEW_COMMENT",
          blogId: comment.blogId,
          message: payload.body
        });
        break;
      }

      case "LIKE_COMMENT": {
        const comment = await Comment.findById(commentId).populate("createdBy");
        if (!comment) return res.status(404).json({ error: "Comment not found" });
        if (senderId === comment.createdBy._id.toString()) return res.status(400).json({});

        const blog = await Blog.findById(comment.blogId);
        payload = {
          title: "Comment Liked",
          body:  `${sender.fullname} liked your comment on: ${blog.title}`,
          url:   `/blog/${comment.blogId}`
        };
        recipientIds = [comment.createdBy._id];

        await Notification.create({
          recipient: comment.createdBy._id,
          sender: senderId,
          type: "LIKE_COMMENT",
          blogId: comment.blogId,
          message: payload.body
        });
        break;
      }

      default: return res.status(400).json({ error: "Invalid action" });
    }

    // 4️⃣  Send push to every recipient who has subscribed
    for (const rid of recipientIds) {
      const record = await PushSub.findOne({ userId: rid });
      if (record) {
        try {
          await webpush.sendNotification(record.subscription, JSON.stringify(payload));
        } catch (err) {
          console.error("Push failed", err);
          if (err.statusCode === 410 || err.statusCode === 404) {
            await PushSub.deleteOne({ userId: rid });
          }
        }
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("trigger error", e);
    res.status(500).json({ error: "Trigger failed" });
  }
});

module.exports = router;
