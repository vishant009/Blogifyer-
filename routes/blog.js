const { Router } = require("express");
const Blog = require("../models/blog");
const Comment = require("../models/comments");
const User = require("../models/user");
const { checkForAuthenticationCookie } = require("../middlewares/auth");
const cloudinaryUpload = require("../middlewares/cloudinaryUpload");
const fetch = require("node-fetch");

const router = Router();

// POST /blog/addBlog
router.post("/addBlog", checkForAuthenticationCookie("token"), cloudinaryUpload.single("coverImage"), async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to create a blog");
    }

    const { title, body } = req.body;
    if (!title?.trim() || !body?.trim()) {
      return res.render("addBlog", {
        user: req.user,
        error_msg: "Title and body are required",
        success_msg: null,
      });
    }

    const blog = await Blog.create({
      title: title.trim(),
      body: body.trim(),
      coverImage: req.file ? req.file.path : null,
      createdBy: req.user._id,
      likes: [],
    });

    // Trigger notification for followers
    await fetch(`http://${req.headers.host}/notificationPush/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "NEW_BLOG",
        blogId: blog._id,
        senderId: req.user._id,
      }),
    });

    return res.redirect(`/?success_msg=Blog created successfully`);
  } catch (err) {
    console.error("Error creating blog:", err);
    return res.render("addBlog", {
      user: req.user,
      error_msg: "Failed to create blog",
      success_msg: null,
    });
  }
});

// POST /blog/like/:id
router.post("/like/:id", checkForAuthenticationCookie("token"), async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to like a blog");
    }

    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.redirect(`/?error_msg=Blog not found`);
    }

    const isLiked = blog.likes.includes(req.user._id);
    if (isLiked) {
      blog.likes = blog.likes.filter((id) => !id.equals(req.user._id));
    } else {
      blog.likes.push(req.user._id);
      // Trigger notification for blog owner
      await fetch(`http://${req.headers.host}/notificationPush/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "LIKE_BLOG",
          blogId: blog._id,
          senderId: req.user._id,
          recipientId: blog.createdBy,
        }),
      });
    }

    await blog.save();
    return res.redirect(`/?success_msg=${isLiked ? "Blog unliked" : "Blog liked"}`);
  } catch (err) {
    console.error("Error liking blog:", err);
    return res.redirect(`/?error_msg=Failed to like blog`);
  }
});

// POST /blog/comment/:id
router.post("/comment/:id", checkForAuthenticationCookie("token"), async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to comment");
    }

    const { content } = req.body;
    if (!content?.trim()) {
      return res.redirect(`/blog/${req.params.id}?error_msg=Comment cannot be empty`);
    }

    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.redirect(`/?error_msg=Blog not found`);
    }

    const comment = await Comment.create({
      content: content.trim(),
      blogId: blog._id,
      createdBy: req.user._id,
      likes: [],
    });

    // Trigger notification for blog owner
    await fetch(`http://${req.headers.host}/notificationPush/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "NEW_COMMENT",
        commentId: comment._id,
        senderId: req.user._id,
        recipientId: blog.createdBy,
      }),
    });

    return res.redirect(`/blog/${req.params.id}?success_msg=Comment added`);
  } catch (err) {
    console.error("Error adding comment:", err);
    return res.redirect(`/blog/${req.params.id}?error_msg=Failed to add comment`);
  }
});

// POST /blog/comment/like/:id
router.post("/comment/like/:id", checkForAuthenticationCookie("token"), async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to like a comment");
    }

    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      return res.redirect(`/?error_msg=Comment not found`);
    }

    const isLiked = comment.likes.includes(req.user._id);
    if (isLiked) {
      comment.likes = comment.likes.filter((id) => !id.equals(req.user._id));
    } else {
      comment.likes.push(req.user._id);
      // Trigger notification for comment owner
      await fetch(`http://${req.headers.host}/notificationPush/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "LIKE_COMMENT",
          commentId: comment._id,
          senderId: req.user._id,
          recipientId: comment.createdBy,
        }),
      });
    }

    await comment.save();
    return res.redirect(`/blog/${comment.blogId}?success_msg=${isLiked ? "Comment unliked" : "Comment liked"}`);
  } catch (err) {
    console.error("Error liking comment:", err);
    return res.redirect(`/?error_msg=Failed to like comment`);
  }
});

module.exports = router;
