require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cookieParser = require("cookie-parser");
const methodOverride = require("method-override");
const moment = require("moment");

const settingsRoute = require("./routes/settings");
const userRoute = require("./routes/user");
const blogRoute = require("./routes/blog");
const commentRoute = require("./routes/comments");
const profileRoute = require("./routes/profile");
const notificationRoute = require("./routes/notification");
const { checkForAuthenticationCookie } = require("./middlewares/auth");

const dashboardRoute = require("./routes/Dashboard");




const app = express();
const PORT = process.env.PORT || 8000;

// Validate environment variables
const requiredEnvVars = ['MONGODB_URI', 'PORT', 'JWT_SECRET', 'EMAIL_USER', 'EMAIL_PASS'];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is missing`);
    process.exit(1);
  }
});

// Debug: Log environment variables (mask sensitive info)
console.log('MONGODB_URI:', process.env.MONGODB_URI);
console.log('PORT:', process.env.PORT);
console.log('JWT_SECRET:', process.env.JWT_SECRET);
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS:', '****'); // Mask password

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Middleware
app.use(methodOverride("_method"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(checkForAuthenticationCookie("token"));
app.use(express.static(path.resolve("./public")));

// View Engine
app.set("view engine", "ejs");
app.set("views", path.resolve("./views"));

// Global Variables
app.locals.moment = moment;

// Error Handling Utility
const renderWithError = (res, view, data, errorMsg, redirectUrl = "/") => {
  console.error(`Error in ${view}:`, errorMsg);
  return res.render(view, { ...data, error_msg: errorMsg, success_msg: null });
};

// Home Route
app.get("/", async (req, res) => {
  try {
    const Blog = require("./models/blog");
    const Comment = require("./models/comments");
    const allBlogs = await Blog.find()
      .populate("createdBy", "fullname email profileImageURL followers")
      .sort({ createdAt: -1 });

    const blogsWithComments = await Promise.all(
      allBlogs.map(async (blog) => {
        const comments = await Comment.find({ blogId: blog._id })
          .populate("createdBy", "fullname profileImageURL")
          .populate("likes", "fullname profileImageURL")
          .sort({ createdAt: -1 });
        const isFollowing = req.user
          ? blog.createdBy.followers.some((follower) => follower._id.equals(req.user._id))
          : false;
        return { ...blog._doc, comments, isFollowing };
      })
    );

    res.render("home", {
      user: req.user || null,
      blogs: blogsWithComments,
      success_msg: req.query.success_msg || null,
      error_msg: req.query.error_msg || null,
    });
  } catch (err) {
    renderWithError(res, "home", { user: req.user || null, blogs: [] }, "Failed to load blogs");
  }
});

// Search Route
app.get("/search", async (req, res) => {
  try {
    const { q } = req.query;
    const query = q ? q.trim() : "";
    let users = [];
    let blogs = [];

    if (query) {
      const User = require("./models/user");
      const Blog = require("./models/blog");

      users = await User.find({
        $or: [
          { fullname: { $regex: query, $options: "i" } },
          { email: { $regex: query, $options: "i" } },
        ],
      })
        .populate("followers", "fullname profileImageURL")
        .sort({ fullname: 1 });

      console.log("Found users:", users.map(u => u._id.toString()));

      blogs = await Blog.find({
        $or: [
          { title: { $regex: query, $options: "i" } },
          { body: { $regex: query, $options: "i" } },
        ],
      })
        .populate("createdBy", "fullname profileImageURL")
        .sort({ createdAt: -1 });
    }

    res.render("search", {
      user: req.user || null,
      currentUser: req.user || null,
      users,
      blogs,
      query,
      success_msg: req.query.success_msg || null,
      error_msg: req.query.error_msg || null,
    });
  } catch (err) {
    console.error("Error in search:", err);
    renderWithError(res, "search", { user: req.user || null, currentUser: req.user || null, users: [], blogs: [], query: "" }, "Failed to load search results");
  }
});

// Routes
app.use("/user", userRoute);
app.use("/blog", blogRoute);
app.use("/comment", commentRoute);
app.use("/profile", profileRoute);
app.use("/settings", settingsRoute);
app.use("/notification", notificationRoute);
app.use("/dashboard", dashboardRoute);

// Start Server
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

module.exports = app;
