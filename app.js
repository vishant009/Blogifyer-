require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cookieParser = require("cookie-parser");
const methodOverride = require("method-override");
const moment = require("moment");
const csrf = require("csurf");
const rateLimit = require("express-rate-limit");

const settingsRoute = require("./routes/settings");
const userRoute = require("./routes/user");
const blogRoute = require("./routes/blog");
const commentRoute = require("./routes/comments");
const profileRoute = require("./routes/profile");
const notificationRoute = require("./routes/notification");
const { checkForAuthenticationCookie } = require("./middlewares/auth");

const app = express();
const PORT = process.env.PORT || 8000;

// Validate environment variables
const requiredEnvVars = ['MONGODB_URI', 'PORT', 'JWT_SECRET', 'EMAIL_USER', 'EMAIL_PASS', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is missing`);
    process.exit(1);
  }
});

// Debug: Log environment variables (mask sensitive info)
console.log('MONGODB_URI:', process.env.MONGODB_URI);
console.log('PORT:', process.env.PORT);
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '****' : 'missing');
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS:', '****');
console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME);
console.log('CLOUDINARY_API_KEY:', '****');
console.log('CLOUDINARY_API_SECRET:', '****');

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Rate limiter for blog creation
const createBlogLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 blog posts per windowMs
  message: "Too many blog creation attempts, please try again later",
});

// Middleware
app.use(methodOverride("_method"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(csrf({ cookie: true }));
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
  return res.render(view, { ...data, error_msg: errorMsg, success_msg: null, csrfToken: res.locals._csrf });
};

// Home Route
app.get("/", async (req, res) => {
  try {
    const Blog = require("./models/blog");
    const Comment = require("./models/comments");
    const allBlogs = await Blog.find({ status: "published" })
      .populate("createdBy", "fullname email profileImageURL followers")
      .sort({ createdAt: -1 });

    const blogsWithComments = await Promise.all(
      allBlogs.map(async (blog) => {
        const comments = await Comment.find({ blogId: blog._id, parentCommentId: null })
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
      csrfToken: req.csrfToken(),
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
        profileVisibility: { $in: ["public", req.user ? "followers" : null] },
      })
        .populate("followers", "fullname profileImageURL")
        .sort({ fullname: 1 });

      console.log("Found users:", users.map(u => u._id.toString()));

      blogs = await Blog.find({
        $or: [
          { title: { $regex: query, $options: "i" } },
          { body: { $regex: query, $options: "i" } },
          { tags: { $regex: query, $options: "i" } },
        ],
        status: "published",
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
      csrfToken: req.csrfToken(),
    });
  } catch (err) {
    console.error("Error in search:", err);
    renderWithError(res, "search", { user: req.user || null, currentUser: req.user || null, users: [], blogs: [], query: "" }, "Failed to load search results");
  }
});

// Search Autocomplete Endpoint
app.get("/search/autocomplete", async (req, res) => {
  try {
    const { q } = req.query;
    const query = q ? q.trim() : "";
    if (!query) return res.json([]);

    const User = require("./models/user");
    const Blog = require("./models/blog");

    const users = await User.find({
      $or: [
        { fullname: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ],
      profileVisibility: { $in: ["public", req.user ? "followers" : null] },
    })
      .select("fullname")
      .limit(5);

    const blogs = await Blog.find({
      $or: [
        { title: { $regex: query, $options: "i" } },
        { tags: { $regex: query, $options: "i" } },
      ],
      status: "published",
    })
      .select("title")
      .limit(5);

    const suggestions = [
      ...users.map(u => ({ type: "user", value: u.fullname })),
      ...blogs.map(b => ({ type: "blog", value: b.title })),
    ];

    res.json(suggestions);
  } catch (err) {
    console.error("Error in autocomplete:", err);
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

// Routes
app.use("/user", userRoute);
app.use("/blog", createBlogLimiter, blogRoute);
app.use("/comment", commentRoute);
app.use("/profile", profileRoute);
app.use("/settings", settingsRoute);
app.use("/notification", notificationRoute);

// CSRF Error Handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render("signin", {
      title: "Sign In",
      user: req.user || null,
      error: "Invalid CSRF token",
      success_msg: null,
      csrfToken: req.csrfToken(),
    });
  }
  next(err);
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).render("error", {
    user: req.user || null,
    error_msg: "An unexpected error occurred. Please try again later.",
    success_msg: null,
    csrfToken: req.csrfToken(),
  });
});

// Start Server
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

module.exports = app;
