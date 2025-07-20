// routes/dashboard.js
const { Router } = require("express");
const User = require("../models/user");
const Blog = require("../models/blog");
const Comment = require("../models/comments");
const { createHmac, randomBytes } = require("crypto");
const cloudinaryUpload = require("../middlewares/cloudinaryUpload");
const { createTokenForUser } = require("../services/authentication");

const router = Router();

// Utility to render dashboard
const renderDashboard = (res, user, users, messages = {}) =>
  res.render("dashboard", {
    user,
    users: users || [],
    success_msg: messages.success_msg || null,
    error_msg: messages.error_msg || null,
  });

// GET /dashboard
router.get("/", async (req, res) => {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.redirect("/user/signin?error_msg=Admin access required");
    }

    const { q } = req.query;
    const users = q
      ? await User.find({
          $or: [
            { fullname: { $regex: q, $options: "i" } },
            { email: { $regex: q, $options: "i" } },
          ],
        }).sort({ fullname: 1 })
      : await User.find().sort({ fullname: 1 });

    renderDashboard(res, req.user, users, {
      success_msg: req.query.success_msg,
      error_msg: req.query.error_msg,
    });
  } catch (err) {
    console.error("Error loading dashboard:", err);
    renderDashboard(res, req.user, [], { error_msg: "Failed to load users" });
  }
});

// POST /dashboard/update/:id
router.post("/update/:id", cloudinaryUpload.single("profileImage"), async (req, res) => {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.redirect("/user/signin?error_msg=Admin access required");
    }

    const { id } = req.params;
    const { fullname, email, password } = req.body;
    const update = {};

    if (fullname?.trim()) update.fullname = fullname.trim();
    if (email?.trim()) update.email = email.trim();
    if (password?.trim()) {
      const salt = randomBytes(16).toString("hex");
      update.salt = salt;
      update.password = createHmac("sha256", salt).update(password).digest("hex");
    }
    if (req.file) update.profileImageURL = req.file.path;

    await User.findByIdAndUpdate(id, update);

    if (id === req.user._id.toString()) {
      const updatedUser = await User.findById(id);
      const token = createTokenForUser(updatedUser);
      res.cookie("token", token, { httpOnly: true });
    }

    return res.redirect("/dashboard?success_msg=User updated");
  } catch (err) {
    console.error("Error updating user:", err);
    return res.redirect("/dashboard?error_msg=Failed to update user");
  }
});

// DELETE /dashboard/delete/:id
router.delete("/delete/:id", async (req, res) => {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.redirect("/user/signin?error_msg=Admin access required");
    }

    const { id } = req.params;
    if (id === req.user._id.toString()) {
      return res.redirect("/dashboard?error_msg=Cannot delete your own account");
    }

    await Promise.all([
      User.findByIdAndDelete(id),
      Blog.deleteMany({ createdBy: id }),
      Comment.deleteMany({ createdBy: id }),
    ]);

    return res.redirect("/dashboard?success_msg=User deleted");
  } catch (err) {
    console.error("Error deleting user:", err);
    return res.redirect("/dashboard?error_msg=Failed to delete user");
  }
});

// DELETE /dashboard/delete-post/:id
router.delete("/delete-post/:id", async (req, res) => {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.redirect("/user/signin?error_msg=Admin access required");
    }

    await Promise.all([
      Blog.findByIdAndDelete(req.params.id),
      Comment.deleteMany({ blogId: req.params.id }),
    ]);

    return res.redirect("/dashboard?success_msg=Blog deleted");
  } catch (err) {
    console.error("Error deleting blog:", err);
    return res.redirect("/dashboard?error_msg=Failed to delete blog");
  }
});

// DELETE /dashboard/delete-comment/:id
router.delete("/delete-comment/:id", async (req, res) => {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.redirect("/user/signin?error_msg=Admin access required");
    }

    await Comment.findByIdAndDelete(req.params.id);
    return res.redirect("/dashboard?success_msg=Comment deleted");
  } catch (err) {
    console.error("Error deleting comment:", err);
    return res.redirect("/dashboard?error_msg=Failed to delete comment");
  }
});

module.exports = router;
