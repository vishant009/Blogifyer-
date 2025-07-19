const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const path = require('path');
const dotenv = require('dotenv');
const userRouter = require('./routes/user');
const blogRouter = require('./routes/blog');
const profileRouter = require('./routes/profile');
const settingsRouter = require('./routes/settings');
const commentRouter = require('./routes/comments');
const notificationRouter = require('./routes/notification');
const csrf = require('csurf');
const { checkAuth } = require('./middlewares/auth');
const sanitizeHtml = require('sanitize-html');

dotenv.config();

const app = express();

// Environment variable validation
const requiredEnvVars = [
  'MONGODB_URI',
  'JWT_SECRET',
  'SESSION_SECRET',
  'EMAIL_USER',
  'EMAIL_PASS',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET'
];

if (process.env.NODE_ENV === 'production') {
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    console.error(`Error: Missing environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }
} else {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'default-session-secret-for-dev';
}

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true }
}));

// CSRF protection
const csrfProtection = csrf({ cookie: true });
app.use(csrfProtection);

// Add CSRF token and user to locals for all views
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.user = req.user || null;
  next();
});

// Check authentication for all routes
app.use(checkAuth);

// Validate and use routers with detailed logging
console.log('Starting router validation...');
const routers = [
  { path: '/user', router: userRouter, name: 'userRouter', file: './routes/user.js' },
  { path: '/blog', router: blogRouter, name: 'blogRouter', file: './routes/blog.js' },
  { path: '/profile', router: profileRouter, name: 'profileRouter', file: './routes/profile.js' },
  { path: '/settings', router: settingsRouter, name: 'settingsRouter', file: './routes/settings.js' },
  { path: '/comment', router: commentRouter, name: 'commentRouter', file: './routes/comments.js' },
  { path: '/notification', router: notificationRouter, name: 'notificationRouter', file: './routes/notification.js' }
];

routers.forEach(({ path, router, name, file }, index) => {
  console.log(`Validating ${name} from ${file} (index: ${index})...`);
  try {
    if (!router) {
      console.error(`Error: ${name} is undefined. Check if ${file} exists and exports a router.`);
      throw new Error(`${name} is undefined`);
    }
    if (typeof router !== 'function') {
      console.error(`Error: ${name} is not a function. Actual value: ${JSON.stringify(router)}`);
      throw new Error(`${name} is not a valid middleware function`);
    }
    if (!router.stack) {
      console.error(`Error: ${name} is not an Express router. Ensure ${file} uses express.Router().`);
      throw new Error(`${name} is not an Express router`);
    }
    app.use(path, router);
    console.log(`Successfully mounted ${name} at ${path} (index: ${index})`);
  } catch (err) {
    console.error(`Failed to mount ${name} at ${path}: ${err.message}`);
  }
});
console.log('Router validation complete.');

// Home route
app.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const Blog = require('./models/blog');
    const blogs = await Blog.find({ status: 'published' })
      .populate('createdBy', 'fullname profileImageURL')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    const totalBlogs = await Blog.countDocuments({ status: 'published' });
    res.render('index', {
      user: req.user || null,
      blogs,
      currentPage: page,
      totalPages: Math.ceil(totalBlogs / limit),
      error_msg: req.query.error_msg || null,
      success_msg: req.query.success_msg || null
    });
  } catch (err) {
    console.error('Error loading home page:', err);
    res.render('error', {
      user: req.user || null,
      error_msg: 'Failed to load blogs',
      csrfToken: req.csrfToken()
    });
  }
});

// Search route
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q ? req.query.q.trim() : '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const sanitizedQuery = sanitizeHtml(query, {
      allowedTags: [],
      allowedAttributes: {}
    });

    if (!sanitizedQuery) {
      return res.render('search', {
        user: req.user || null,
        query: '',
        users: [],
        blogs: [],
        currentPage: 1,
        totalPages: 1,
        error_msg: 'Please enter a valid search query',
        success_msg: null,
        csrfToken: req.csrfToken()
      });
    }

    const User = require('./models/user');
    const Blog = require('./models/blog');

    const [users, blogs] = await Promise.all([
      User.find({
        $or: [
          { fullname: { $regex: sanitizedQuery, $options: 'i' } },
          { email: { $regex: sanitizedQuery, $options: 'i' } }
        ],
        profileVisibility: 'public'
      }).select('fullname email profileImageURL followers').skip(skip).limit(limit),
      Blog.find({
        status: 'published',
        $or: [
          { title: { $regex: sanitizedQuery, $options: 'i' } },
          { body: { $regex: sanitizedQuery, $options: 'i' } },
          { tags: { $regex: sanitizedQuery, $options: 'i' } }
        ]
      }).populate('createdBy', 'fullname profileImageURL').sort({ createdAt: -1 }).skip(skip).limit(limit)
    ]);

    const [totalUsers, totalBlogs] = await Promise.all([
      User.countDocuments({
        $or: [
          { fullname: { $regex: sanitizedQuery, $options: 'i' } },
          { email: { $regex: sanitizedQuery, $options: 'i' } }
        ],
        profileVisibility: 'public'
      }),
      Blog.countDocuments({
        status: 'published',
        $or: [
          { title: { $regex: sanitizedQuery, $options: 'i' } },
          { body: { $regex: sanitizedQuery, $options: 'i' } },
          { tags: { $regex: sanitizedQuery, $options: 'i' } }
        ]
      })
    ]);

    res.render('search', {
      user: req.user || null,
      query: sanitizedQuery,
      users,
      blogs,
      currentPage: page,
      totalPages: Math.max(Math.ceil(totalUsers / limit), Math.ceil(totalBlogs / limit)),
      error_msg: null,
      success_msg: null,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    console.error('Search error:', err);
    res.render('error', {
      user: req.user || null,
      error_msg: 'Failed to perform search',
      csrfToken: req.csrfToken()
    });
  }
});

// Autocomplete route
app.get('/search/autocomplete', async (req, res) => {
  try {
    const query = req.query.q ? req.query.q.trim() : '';
    const sanitizedQuery = sanitizeHtml(query, {
      allowedTags: [],
      allowedAttributes: {}
    });

    if (!sanitizedQuery) {
      return res.json([]);
    }

    const User = require('./models/user');
    const Blog = require('./models/blog');

    const [users, blogs] = await Promise.all([
      User.find({
        $or: [
          { fullname: { $regex: sanitizedQuery, $options: 'i' } },
          { email: { $regex: sanitizedQuery, $options: 'i' } }
        ],
        profileVisibility: 'public'
      }).select('fullname').limit(5),
      Blog.find({
        status: 'published',
        $or: [
          { title: { $regex: sanitizedQuery, $options: 'i' } },
          { tags: { $regex: sanitizedQuery, $options: 'i' } }
        ]
      }).select('title').limit(5)
    ]);

    const suggestions = [
      ...users.map(user => ({ type: 'user', value: user.fullname })),
      ...blogs.map(blog => ({ type: 'blog', value: blog.title }))
    ];

    res.json(suggestions);
  } catch (err) {
    console.error('Autocomplete error:', err);
    res.status(500).json([]);
  }
});

// Error handling for CSRF errors
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    res.status(403).render('error', {
      user: req.user || null,
      error_msg: 'Invalid CSRF token',
      csrfToken: req.csrfToken()
    });
  } else {
    console.error('Server error:', err);
    res.status(500).render('error', {
      user: req.user || null,
      error_msg: 'Something went wrong',
      csrfToken: req.csrfToken()
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
