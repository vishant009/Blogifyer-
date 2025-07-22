require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cookieParser = require("cookie-parser");
const methodOverride = require("method-override");
const moment = require("moment");
const csrf = require("csurf"); // Add csurf

const settingsRoute = require("./routes/settings");
const userRoute = require("./routes/user");
const blogRoute = require("./routes/blog");
const commentRoute = require("./routes/comments");
const profileRoute = require("./routes/profile");
const notificationRoute = require("./routes/notification");
const notificationPushRoute = require("./routes/notificationPush");
const { checkForAuthenticationCookie } = require("./middlewares/auth");
const dashboardRoute = require("./routes/Dashboard");

const app = express();
const PORT = process.env.PORT || 8000;

// Validate environment variables
const requiredEnvVars = ['MONGODB_URI', 'PORT', 'JWT_SECRET', 'EMAIL_USER', 'EMAIL_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is missing`);
    process.exit(1);
  }
});

// Debug: Log environment variables (mask sensitive info)
console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'Set' : 'Not Set');
console.log('PORT:', process.env.PORT);
console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'Set' : 'Not Set');
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS:', '****');
console.log('VAPID_PUBLIC_KEY:', process.env.VAPID_PUBLIC_KEY ? 'Set' : 'Not Set');
console.log('VAPID_PRIVATE_KEY:', '****');

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Middleware
app.use(methodOverride("_method"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(csrf({ cookie: true })); // Add CSRF middleware
app.use(checkForAuthenticationCookie("token"));
app.use(express.static(path.resolve("./public")));

// Add CSRF token to all rendered views
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

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
      csrfToken: req.csrfToken(), // Pass CSRF token to view
    });
  } catch (err) {
    console.error("Error in home route:", err);
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
      csrfToken: req.csrfToken(), // Pass CSRF token to view
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
app.use("/notificationPush", notificationPushRoute);
app.use("/dashboard", dashboardRoute);

// Error Handling for Uncaught Routes
app.use((req, res) => {
  res.status(404).render("error", {
    user: req.user || null,
    error_msg: "Page not found",
    success_msg: null,
    csrfToken: req.csrfToken(), // Pass CSRF token to view
  });
});

// CSRF Error Handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    console.error("CSRF token error:", err);
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  next(err);
});

// Start Server
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

module.exports = app;
