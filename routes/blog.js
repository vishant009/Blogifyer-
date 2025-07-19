const { Router } = require("express");
const Blog = require("../models/blog");
const Comment = require("../models/comments");
const User = require("../models/user");
const Notification = require("../models/notification");
const cloudinaryUpload = require("../middlewares/cloudinaryUpload");

const router = Router();

// GET /blog/addBlog
router.get("/addBlog", (req, res) =>
  res.render("addBlog", {
    user: req.user || null,
    error_msg: req.query.error_msg || null,
    success_msg: req.query.success_msg || null,
    categories: ["Technology", "Lifestyle", "Education", "Travel", "Food", "Other"],
  })
);

// GET /blog/edit/:id
router.get("/edit/:id", async (req, res) => {
  try {
    if (!req.user) return res.redirect("/user/signin?error_msg=Please log in to edit a blog");
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.redirect("/?error_msg=Blog not found");
    if (blog.createdBy.toString() !== req.user._id.toString()) {
      return res.redirect("/?error_msg=Unauthorized to edit this blog");
    }

    return res.render("editBlog", {
      user: req.user || null,
      blog,
      categories: ["Technology", "Lifestyle", "Education", "Travel", "Food", "Other"],
      error_msg: req.query.error_msg || null,
      success_msg: req.query.success_msg || null,
    });
  } catch (err) {
    console.error("Error loading edit blog page:", err);
    return res.redirect("/?error_msg=Failed to load blog");
  }
});

// GET /blog/:id
router.get("/:id", async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id)
      .populate("createdBy", "fullname email profileImageURL")
      .populate("likes", "fullname profileImageURL");

    if (!blog || blog.status !== "published") return res.redirect("/?error_msg=Blog not found");

    const comments = await Comment.find({ blogId: req.params.id, parentCommentId: null })
      .populate("createdBy", "fullname profileImageURL")
      .populate({
        path: "replies",
        populate: { path: "createdBy", select: "fullname profileImageURL" },
      })
      .sort({ createdAt: -1 });

    return res.render("blog", {
      user: req.user || null,
      blog,
      comments,
      error_msg: req.query.error_msg || null,
      success_msg: req.query.success_msg || null,
    });
  } catch (err) {
    console.error("Error loading blog:", err);
    return res.redirect("/?error_msg=Failed to load blog");
  }
});

// POST /blog
router.post("/", cloudinaryUpload.single("coverImage"), async (req, res) => {
  try {
    if (!req.user) return res.redirect("/blog/addBlog?error_msg=Login required");
    const { title, body, category, tags, status } = req.body;
    
    if (!title?.trim() || !body?.trim()) {
      return res.redirect("/blog/addBlog?error_msg=Title and body are required");
    }

    const blog = await Blog.create({
      body,
      title,
      createdBy: req.user._id,
      coverImage: req.file ? req.file.path : null,
      category: category || "Other",
      tags: tags ? tags.split(",").map(tag => tag.trim()).filter(tag => tag) : [],
      status: status === "draft" ? "draft" : "published",
      likes: [],
    });

    return res.redirect(`/blog/${blog._id}?success_msg=Blog ${status === "draft" ? "saved as draft" : "created"}`);
  } catch (err) {
    console.error("Error creating blog:", err);
    return res.redirect("/blog/addBlog?error_msg=Failed to create blog");
  }
});

// PUT /blog/:id
router.put("/:id", cloudinaryUpload.single("coverImage"), async (req, res) => {
  try {
    if (!req.user) return res.redirect("/user/signin?error_msg=Please log in to edit a blog");
    const { title, body, category, tags, status } = req.body;
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.redirect("/?error_msg=Blog not found");
    if (blog.createdBy.toString() !== req.user._id.toString()) {
      return res.redirect("/?error_msg=Unauthorized to edit this blog");
    }

    if (!title?.trim() || !body?.trim()) {
      return res.redirect(`/blog/edit/${req.params.id}?error_msg=Title and body are required`);
    }

    blog.title = title;
    blog.body = body;
    blog.category = category || "Other";
    blog.tags = tags ? tags.split(",").map(tag => tag.trim()).filter(tag => tag) : [];
    blog.status = status === "draft" ? "draft" : "published";
    if (req.file) blog.coverImage = req.file.path;

    await blog.save();
    return res.redirect(`/blog/${blog._id}?success_msg=Blog updated successfully`);
  } catch (err) {
    console.error("Error updating blog:", err);
    return res.redirect(`/blog/edit/${req.params.id}?error_msg=Failed to update blog`);
  }
});

// DELETE /blog/:id
router.delete("/:id", async (req, res) => {
  try {
    if (!req.user) return res.redirect("/?error_msg=Please log in to delete a blog");
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.redirect("/?error_msg=Blog not found");
    if (blog.createdBy.toString() !== req.user._id.toString()) {
      return res.redirect("/?error_msg=Unauthorized to delete this blog");
    }
    await Blog.findByIdAndDelete(req.params.id);
    await Comment.deleteMany({ blogId: req.params.id });
    await Notification.deleteMany({ blogId: req.params.id });
    return res.redirect("/?success_msg=Blog deleted");
  } catch (err) {
    console.error("Error deleting blog:", err);
    return res.redirect("/?error_msg=Failed to delete blog");
  }
});

// POST /blog/:id/like
router.post("/:id/like", async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect(`/blog/${req.params.id}?error_msg=Please log in to like a blog`);
    }

    const blog = await Blog.findById(req.params.id).populate("createdBy", "fullname");
    if (!blog) {
      return res.redirect(`/blog/${req.params.id}?error_msg=Blog not found`);
    }

    if (blog.createdBy._id.toString() === req.user._id.toString()) {
      return res.redirect(`/blog/${req.params.id}?error_msg=You cannot like your own blog`);
    }

    const user = await User.findById(req.user._id);
    const isLiked = blog.likes.includes(req.user._id);

    if (isLiked) {
      blog.likes.pull(req.user._id);
      user.likedBlogs.pull(req.params.id);
      await Notification.deleteOne({
        sender: req.user._id,
        recipient: blog.createdBy._id,
        type: "LIKE",
        blogId: req.params.id,
      });
    } else {
      blog.likes.push(req.user._id);
      user.likedBlogs.push(req.params.id);

      const existingLikeNotification = await Notification.findOne({
        sender: req.user._id,
        recipient: blog.createdBy._id,
        type: "LIKE",
        blogId: req.params.id,
      });

      if (!existingLikeNotification) {
        await Notification.create({
          recipient: blog.createdBy._id,
          sender: req.user._id,
          type: "LIKE",
          blogId: req.params.id,
          message: `${req.user.fullname} liked your post: ${blog.title}`,
          isRead: false,
        });
      }
    }

    await Promise.all([blog.save(), user.save()]);
    return res.redirect(`/blog/${req.params.id}?success_msg=${isLiked ? "Blog unliked" : "Blog liked"}`);
  } catch (err) {
    console.error("Error liking blog:", err);
    return res.redirect(`/blog/${req.params.id}?error_msg=Failed to like blog`);
  }
});

// GET /blog/drafts
router.get("/drafts", async (req, res) => {
  try {
    if (!req.user) return res.redirect("/user/signin?error_msg=Please log in to view drafts");
    
    const drafts = await Blog.find({ createdBy: req.user._id, status: "draft" })
      .populate("createdBy", "fullname profileImageURL")
      .sort({ createdAt: -1 });

    return res.render("drafts", {
      user: req.user || null,
      drafts,
      error_msg: req.query.error_msg || null,
      success_msg: req.query.success_msg || null,
    });
  } catch (err) {
    console.error("Error loading drafts:", err);
    return res.redirect("/?error_msg=Failed to load drafts");
  }
});

module.exports = router;
