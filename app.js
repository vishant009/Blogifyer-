require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const moment = require('moment');
const csurf = require('csurf');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { createHmac } = require('crypto'); // ✅ ADDED
const { checkForAuthenticationCookie } = require('./middlewares/auth');

const settingsRoute = require('./routes/settings');
const userRoute = require('./routes/user');
const blogRoute = require('./routes/blog');
const commentRoute = require('./routes/comments');
const profileRoute = require('./routes/profile');
const notificationRoute = require('./routes/notification');

const app = express();
const PORT = process.env.PORT || 8000;

const requiredEnvVars = [
  'MONGODB_URI',
  'JWT_SECRET',
  'EMAIL_USER',
  'EMAIL_PASS',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET'
];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is missing`);
    process.exit(1);
  }
});

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

const createBlogLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many blog creation attempts, please try again later'
});

app.use(methodOverride('_method'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-secret',
    resave: false,
    saveUninitialized: false
  })
);
app.use(csurf({ cookie: true }));
app.use(checkForAuthenticationCookie('token'));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.moment = moment;

app.use((req, res, next) => {
  res.locals._csrf = req.csrfToken();
  next();
});

// Home Route
app.get('/', async (req, res) => {
  try {
    const Blog = require('./models/blog');
    const Comment = require('./models/comments');
    const allBlogs = await Blog.find({ status: 'published' })
      .populate('createdBy', 'fullname email profileImageURL followers')
      .sort({ createdAt: -1 });

    const blogsWithComments = await Promise.all(
      allBlogs.map(async (blog) => {
        const comments = await Comment.find({ blogId: blog._id, parentCommentId: null })
          .populate('createdBy', 'fullname profileImageURL')
          .populate('likes', 'fullname profileImageURL')
          .sort({ createdAt: -1 });
        const isFollowing = req.user
          ? blog.createdBy.followers.some((follower) => follower._id.equals(req.user._id))
          : false;
        return { ...blog._doc, comments, isFollowing };
      })
    );

    res.render('home', {
      user: req.user || null,
      blogs: blogsWithComments,
      success_msg: req.query.success_msg || null,
      error_msg: req.query.error_msg || null,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    console.error('Error in home route:', err);
    res.render('home', {
      user: req.user || null,
      blogs: [],
      error_msg: 'Failed to load blogs',
      success_msg: null,
      csrfToken: req.csrfToken()
    });
  }
});

// Search Route
app.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    const query = q ? q.trim() : '';
    let users = [];
    let blogs = [];

    if (query) {
      const User = require('./models/user');
      const Blog = require('./models/blog');

      users = await User.find({
        $or: [{ fullname: { $regex: query, $options: 'i' } }, { email: { $regex: query, $options: 'i' } }],
        profileVisibility: { $in: ['public', req.user ? 'followers' : null] }
      })
        .populate('followers', 'fullname profileImageURL')
        .sort({ fullname: 1 });

      blogs = await Blog.find({
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { body: { $regex: query, $options: 'i' } },
          { tags: { $regex: query, $options: 'i' } }
        ],
        status: 'published'
      })
        .populate('createdBy', 'fullname profileImageURL')
        .sort({ createdAt: -1 });
    }

    res.render('search', {
      user: req.user || null,
      currentUser: req.user || null,
      users,
      blogs,
      query,
      success_msg: req.query.success_msg || null,
      error_msg: req.query.error_msg || null,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    console.error('Error in search:', err);
    res.render('search', {
      user: req.user || null,
      currentUser: req.user || null,
      users: [],
      blogs: [],
      query: '',
      error_msg: 'Failed to load search results',
      success_msg: null,
      csrfToken: req.csrfToken()
    });
  }
});

// Search Autocomplete Endpoint
app.get('/search/autocomplete', async (req, res) => {
  try {
    const { q } = req.query;
    const query = q ? q.trim() : '';
    if (!query) return res.json([]);

    const User = require('./models/user');
    const Blog = require('./models/blog');

    const users = await User.find({
      $or: [{ fullname: { $regex: query, $options: 'i' } }, { email: { $regex: query, $options: 'i' } }],
      profileVisibility: { $in: ['public', req.user ? 'followers' : null] }
    })
      .select('fullname')
      .limit(5);

    const blogs = await Blog.find({
      $or: [{ title: { $regex: query, $options: 'i' } }, { tags: { $regex: query, $options: 'i' } }],
      status: 'published'
    })
      .select('title')
      .limit(5);

    const suggestions = [
      ...users.map((u) => ({ type: 'user', value: u.fullname })),
      ...blogs.map((b) => ({ type: 'blog', value: b.title }))
    ];

    res.json(suggestions);
  } catch (err) {
    console.error('Error in autocomplete:', err);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// Routes
app.use('/user', userRoute);
app.use('/blog', createBlogLimiter, blogRoute);
app.use('/comment', commentRoute);
app.use('/profile', profileRoute);
app.use('/settings', settingsRoute);
app.use('/notification', notificationRoute);

// CSRF Error Handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('signin', {
      title: 'Sign In',
      user: req.user || null,
      error_msg: 'Invalid CSRF token',
      success_msg: null,
      email: '',
      csrfToken: req.csrfToken()
    });
  }
  next(err);
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).render('error', {
    user: req.user || null,
    error_msg: 'An unexpected error occurred. Please try again later.',
    success_msg: null,
    csrfToken: req.csrfToken()
  });
});

// Start Server
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

module.exports = app;
