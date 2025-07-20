// routes/dashboard.js
const { Router } = require("express");
const User = require("../models/user");
const Blog = require("../models/blog");
const Comment = require("../models/comments");
const { createHmac, randomBytes } = require("crypto");
const cloudinaryUpload = require("../middlewares/cloudinaryUpload");
const { createTokenForUser } = require("../services/authentication");

const router = Router();

// GET /dashboard  – list/search users
router.get("/", async (req, res) => {
  try {
    if (!req.user) return res.redirect("/user/signin?error_msg=Please sign in");

    const { q } = req.query;
    const users = q
      ? await User.find({
          $or: [
            { fullname: { $regex: q, $options: "i" } },
            { email: { $regex: q, $options: "i" } },
          ],
        }).sort({ fullname: 1 })
      : await User.find().sort({ fullname: 1 });

    res.render("dashboard", {
      user: req.user,
      users,
      success_msg: req.query.success_msg || null,
      error_msg: req.query.error_msg || null,
    });
  } catch (err) {
    console.error(err);
    res.redirect("/?error_msg=Dashboard load failed");
  }
});

// POST /dashboard/update/:id  – update any user
router.post("/update/:id", cloudinaryUpload.single("profileImage"), async (req, res) => {
  try {
    if (!req.user) return res.redirect("/user/signin");

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

    // refresh token if editing self
    if (id === req.user._id.toString()) {
      const updated = await User.findById(id);
      res.cookie("token", createTokenForUser(updated), { httpOnly: true });
    }

    res.redirect("/dashboard?success_msg=User updated");
  } catch (err) {
    console.error(err);
    res.redirect("/dashboard?error_msg=Update failed");
  }
});

// DELETE /dashboard/delete/:id  – delete any user
router.delete("/delete/:id", async (req, res) => {
  try {
    if (!req.user) return res.redirect("/user/signin");

    const { id } = req.params;
    await Promise.all([
      User.findByIdAndDelete(id),
      Blog.deleteMany({ createdBy: id }),
      Comment.deleteMany({ createdBy: id }),
    ]);
    res.redirect("/dashboard?success_msg=User deleted");
  } catch (err) {
    console.error(err);
    res.redirect("/dashboard?error_msg=Delete failed");
  }
});

// DELETE /dashboard/delete-post/:id  – delete any blog
router.delete("/delete-post/:id", async (req, res) => {
  try {
    if (!req.user) return res.redirect("/user/signin");

    await Promise.all([
      Blog.findByIdAndDelete(req.params.id),
      Comment.deleteMany({ blogId: req.params.id }),
    ]);
    res.redirect("/dashboard?success_msg=Blog deleted");
  } catch (err) {
    console.error(err);
    res.redirect("/dashboard?error_msg=Delete failed");
  }
});

// DELETE /dashboard/delete-comment/:id  – delete any comment
router.delete("/delete-comment/:id", async (req, res) => {
  try {
    if (!req.user) return res.redirect("/user/signin");
    await Comment.findByIdAndDelete(req.params.id);
    res.redirect("/dashboard?success_msg=Comment deleted");
  } catch (err) {
    console.error(err);
    res.redirect("/dashboard?error_msg=Delete failed");
  }
});

module.exports = router;
