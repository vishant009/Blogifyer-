const { Router } = require("express");
const User = require("../models/user");
const Blog = require("../models/blog");
const Comment = require("../models/comments");
const { createHmac, randomBytes } = require("crypto");
const cloudinaryUpload = require("../middlewares/cloudinaryUpload");
const { createTokenForUser } = require("../services/authentication");

const router = Router();

// Utility to render dashboard with defaults
const renderDashboard = (res, user, users, messages = {}) => {
  return res.render("dashboard", {
    user: user || null,
    users: users || [],
    success_msg: messages.success_msg || null,
    error_msg: messages.error_msg || null,
  });
};

// GET /dashboard - Display all users with search functionality
router.get("/", async (req, res) => {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.redirect("/user/signin?error_msg=Admin access required");
    }

    const { q } = req.query;
    let users = [];
    
    if (q) {
      users = await User.find({
        $or: [
          { fullname: { $regex: q, $options: "i" } },
          { email: { $regex: q, $options: "i" } },
        ],
      }).sort({ fullname: 1 });
    } else {
      users = await User.find().sort({ fullname: 1 });
    }

    renderDashboard(res, req.user, users, {
      success_msg: req.query.success_msg,
      error_msg: req.query.error_msg,
    });
  } catch (err) {
    console.error("Error loading dashboard:", err);
    renderDashboard(res, req.user, [], { error_msg: "Failed to load users" });
  }
});

// POST /dashboard/update/:id - Update user profile (name, email, password, profile image)
router.post("/update/:id", cloudinaryUpload.single("profileImage"), async (req, res) => {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.redirect("/user/signin?error_msg=Admin access required");
    }

    const { id } = req.params;
    const { fullname, email, password } = req.body;
    const update = {};

    if (fullname?.trim()) {
      if (fullname.trim().length < 2) {
        return res.redirect("/dashboard?error_msg=Full name must be at least 2 characters");
      }
      update.fullname = fullname.trim();
    }

    if (email?.trim()) {
      const e = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        return res.redirect("/dashboard?error_msg=Invalid email format");
      }
      const exists = await User.findOne({ email: e, _id: { $ne: id } });
      if (exists) return res.redirect("/dashboard?error_msg=Email already in use");
      update.email = e;
    }

    if (password?.trim()) {
      if (password.length < 6) {
        return res.redirect("/dashboard?error_msg=Password must be at least 6 characters");
      }
      const salt = randomBytes(16).toString("hex");
      update.salt = salt;
      update.password = createHmac("sha256", salt).update(password).digest("hex");
    }

    if (req.file) {
      update.profileImageURL = req.file.path; // Cloudinary URL
    }

    if (!Object.keys(update).length) {
      return res.redirect("/dashboard?error_msg=No changes provided");
    }

    const updatedUser = await User.findByIdAndUpdate(id, update, { new: true });
    if (!updatedUser) return res.redirect("/dashboard?error_msg=User not found");

    // If updating the logged-in admin, refresh their token
    if (id === req.user._id.toString()) {
      const token = createTokenForUser(updatedUser);
      res.cookie("token", token, { httpOnly: true });
    }

    return res.redirect("/dashboard?success_msg=User profile updated successfully");
  } catch (err) {
    console.error("Error updating user:", err);
    return res.redirect("/dashboard?error_msg=Failed to update user profile");
  }
});

// DELETE /dashboard/delete/:id - Delete a user
router.delete("/delete/:id", async (req, res) => {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.redirect("/user/signin?error_msg=Admin access required");
    }

    const { id } = req.params;
    if (id === req.user._id.toString()) {
      return res.redirect("/dashboard?error_msg=Cannot delete your own account");
    }

    const user = await User.findById(id);
    if (!user) return res.redirect("/dashboard?error_msg=User not found");

    await Promise.all([
      User.findByIdAndDelete(id),
      Blog.deleteMany({ createdBy: id }),
      Comment.deleteMany({ createdBy: id }),
    ]);

    return res.redirect("/dashboard?success_msg=User deleted successfully");
  } catch (err) {
    console.error("Error deleting user:", err);
    return res.redirect("/dashboard?error_msg=Failed to delete user");
  }
});

// DELETE /dashboard/delete-post/:id - Delete a blog post
router.delete("/delete-post/:id", async (req, res) => {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.redirect("/user/signin?error_msg=Admin access required");
    }

    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.redirect("/dashboard?error_msg=Blog not found");

    await Promise.all([
      Blog.findByIdAndDelete(req.params.id),
      Comment.deleteMany({ blogId: req.params.id }),
    ]);

    return res.redirect("/dashboard?success_msg=Blog post deleted successfully");
  } catch (err) {
    console.error("Error deleting blog:", err);
    return res.redirect("/dashboard?error_msg=Failed to delete blog post");
  }
});

// DELETE /dashboard/delete-comment/:id - Delete a comment
router.delete("/delete-comment/:id", async (req, res) => {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.redirect("/user/signin?error_msg=Admin access required");
    }

    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.redirect("/dashboard?error_msg=Comment not found");

    await Comment.findByIdAndDelete(req.params.id);
    return res.redirect("/dashboard?success_msg=Comment deleted successfully");
  } catch (err) {
    console.error("Error deleting comment:", err);
    return res.redirect("/dashboard?error_msg=Failed to delete comment");
  }
});

module.exports = router;
