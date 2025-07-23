const { Router } = require("express");
const Blog = require("../models/blog");
const Comment = require("../models/comments");
const User = require("../models/user");
const { checkForAuthenticationCookie } = require("../middlewares/auth");
const cloudinaryUpload = require("../middlewares/cloudinaryUpload");
const fetch = require("node-fetch");
const mongoose = require("mongoose");

const router = Router();

// GET /blog/:id (View a single blog)
router.get("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid blog ID" });
    }
    const blog = await Blog.findById(req.params.id)
      .populate("createdBy", "fullname email profileImageURL followers blogPermissions")
      .populate("likes", "fullname profileImageURL");
    if (!blog) {
      return res.status(404).json({ success: false, error: "Blog not found" });
    }

    const comments = await Comment.find({ blogId: blog._id })
      .populate("createdBy", "fullname profileImageURL")
      .populate("likes", "fullname profileImageURL")
      .sort({ createdAt: -1 });

    const isFollowing = req.user
      ? blog.createdBy.followers.some((follower) => follower._id.equals(req.user._id))
      : false;

    // Determine if the user can like or comment based on blogPermissions
    let canLike = true;
    let canComment = true;
    if (req.user) {
      const blogOwner = blog.createdBy;
      if (blogOwner.blogPermissions.likes === "followers" && !blogOwner.followers.some(f => f._id.equals(req.user._id))) {
        canLike = false;
      } else if (blogOwner.blogPermissions.likes === "following" && !blogOwner.following.some(f => f._id.equals(req.user._id))) {
        canLike = false;
      }
      if (blogOwner.blogPermissions.comments === "followers" && !blogOwner.followers.some(f => f._id.equals(req.user._id))) {
        canComment = false;
      } else if (blogOwner.blogPermissions.comments === "following" && !blogOwner.following.some(f => f._id.equals(req.user._id))) {
        canComment = false;
      }
    } else {
      canLike = blog.createdBy.blogPermissions.likes === "everyone";
      canComment = blog.createdBy.blogPermissions.comments === "everyone";
    }

    return res.render("blog", {
      user: req.user || null,
      blog,
      comments,
      isFollowing,
      canLike,
      canComment,
      success_msg: req.query.success_msg || null,
      error_msg: req.query.error_msg || null,
    });
  } catch (err) {
    console.error("Error viewing blog:", err);
    return res.status(500).json({ success: false, error: "Failed to load blog" });
  }
});

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
      return res.status(401).json({ success: false, error: "Please log in to like a blog" });
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid blog ID" });
    }

    const blog = await Blog.findById(req.params.id).populate("createdBy", "fullname blogPermissions followers following");
    if (!blog) {
      return res.status(404).json({ success: false, error: "Blog not found" });
    }

    // Check permissions
    const blogOwner = blog.createdBy;
    if (blogOwner.blogPermissions.likes === "followers" && !blogOwner.followers.some(f => f._id.equals(req.user._id))) {
      return res.status(403).json({ success: false, error: "You must be a follower to like this blog" });
    } else if (blogOwner.blogPermissions.likes === "following" && !blogOwner.following.some(f => f._id.equals(req.user._id))) {
      return res.status(403).json({ success: false, error: "The blog owner must be following you to like this blog" });
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
          recipientId: blog.createdBy._id,
        }),
      });
    }

    await blog.save();
    return res.status(200).json({
      success: true,
      isLiked: !isLiked,
      likeCount: blog.likes.length,
      message: isLiked ? "Blog unliked" : "Blog liked",
    });
  } catch (err) {
    console.error("Error liking blog:", err);
    return res.status(500).json({ success: false, error: "Failed to like blog" });
  }
});

// POST /blog/comment/:id
router.post("/comment/:id", checkForAuthenticationCookie("token"), async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to comment");
    }

    const blog = await Blog.findById(req.params.id).populate("createdBy", "fullname blogPermissions followers following");
    if (!blog) {
      return res.redirect(`/?error_msg=Blog not found`);
    }

    // Check permissions
    const blogOwner = blog.createdBy;
    if (blogOwner.blogPermissions.comments === "followers" && !blogOwner.followers.some(f => f._id.equals(req.user._id))) {
      return res.redirect(`/blog/${req.params.id}?error_msg=You must be a follower to comment on this blog`);
    } else if (blogOwner.blogPermissions.comments === "following" && !blogOwner.following.some(f => f._id.equals(req.user._id))) {
      return res.redirect(`/blog/${req.params.id}?error_msg=The blog owner must be following you to comment on this blog`);
    }

    const { content } = req.body;
    if (!content?.trim()) {
      return res.redirect(`/blog/${req.params.id}?error_msg=Comment cannot be empty`);
    }

    const comment = await Comment.create({
      content: content.trim(),
      blogId: blog._id,
      createdBy: req.user._id,
      likes: [],
    });

    await fetch(`http://${req.headers.host}/notificationPush/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "NEW_COMMENT",
        commentId: comment._id,
        senderId: req.user._id,
        recipientId: blog.createdBy._id,
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

    const comment = await Comment.findById(req.params.id).populate("blogId", "createdBy");
    if (!comment || !comment.blogId) {
      return res.redirect(`/?error_msg=Comment not found`);
    }

    // Check permissions
    const blogOwner = await User.findById(comment.blogId.createdBy);
    if (blogOwner.blogPermissions.comments === "followers" && !blogOwner.followers.some(f => f._id.equals(req.user._id))) {
      return res.redirect(`/blog/${comment.blogId._id}?error_msg=You must be a follower to like comments on this blog`);
    } else if (blogOwner.blogPermissions.comments === "following" && !blogOwner.following.some(f => f._id.equals(req.user._id))) {
      return res.redirect(`/blog/${comment.blogId._id}?error_msg=The blog owner must be following you to like comments on this blog`);
    }

    const isLiked = comment.likes.includes(req.user._id);
    if (isLiked) {
      comment.likes = comment.likes.filter((id) => !id.equals(req.user._id));
    } else {
      comment.likes.push(req.user._id);
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
    return res.redirect(`/blog/${comment.blogId}?error_msg=Failed to like comment`);
  }
});

module.exports = router;
