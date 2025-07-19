const { Router } = require("express");
const User = require("../models/user");
const Notification = require("../models/notification");
const { createTokenForUser } = require("../services/authentication");
const { sendEmail } = require("../middlewares/nodemailer");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const validator = require("validator");
const csrf = require("csurf");
const { body, validationResult } = require("express-validator");

const router = Router();
const csrfProtection = csrf({ cookie: true });

// Rate limiter for signin and forgot password
const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: "Too many sign-in attempts, please try again later",
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // Limit each IP to 3 requests per windowMs
  message: "Too many password reset requests, please try again later",
});

// Generate secure token
const generateSecureToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

// Generate 6-digit code
const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Input validation middleware for signup
const validateSignup = [
  body("fullname").trim().notEmpty().withMessage("Full name is required"),
  body("email").isEmail().normalizeEmail().withMessage("Invalid email address"),
  body("password")
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
    .withMessage("Password must be at least 8 characters long and include uppercase, lowercase, number, and special character"),
];

// Input validation middleware for signin
const validateSignin = [
  body("email").isEmail().normalizeEmail().withMessage("Invalid email address"),
  body("password").notEmpty().withMessage("Password is required"),
];

// GET /user/signin
router.get("/signin", csrfProtection, (req, res) => {
  return res.render("signin", {
    title: "Sign In",
    user: req.user || null,
    error: req.query.error_msg,
    success_msg: req.query.success_msg,
    csrfToken: req.csrfToken(),
  });
});

// GET /user/signup
router.get("/signup", csrfProtection, (req, res) => {
  return res.render("signup", {
    title: "Sign Up",
    user: req.user || null,
    error: req.query.error_msg,
    success_msg: req.query.success_msg,
    showVerification: false,
    email: req.query.email || "",
    fullname: req.query.fullname || "",
    csrfToken: req.csrfToken(),
  });
});

// POST /user/signup
router.post(
  "/signup",
  csrfProtection,
  validateSignup,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render("signup", {
        title: "Sign Up",
        user: req.user || null,
        error: errors.array()[0].msg,
        success_msg: null,
        showVerification: false,
        email: req.body.email,
        fullname: req.body.fullname,
        csrfToken: req.csrfToken(),
      });
    }

    const { fullname, email, password } = req.body;
    try {
      const existingUser = await User.findOne({ email });
      if (existingUser && existingUser.isVerified) {
        return res.render("signup", {
          title: "Sign Up",
          user: req.user || null,
          error: "User with this email already exists",
          success_msg: null,
          showVerification: false,
          email,
          fullname,
          csrfToken: req.csrfToken(),
        });
      }

      // Store user in temporary collection or update existing unverified user
      const verificationCode = generateCode();
      const verificationToken = generateSecureToken();

      if (existingUser && !existingUser.isVerified) {
        // Update existing unverified user
        existingUser.fullname = fullname;
        existingUser.password = password;
        existingUser.verificationCode = verificationCode;
        existingUser.verificationToken = verificationToken;
        existingUser.verificationCodeExpires = Date.now() + 3600000; // 1 hour
        await existingUser.save();
      } else {
        // Create new unverified user
        await User.create({
          fullname,
          email,
          password,
          likedBlogs: [],
          bio: "",
          isVerified: false,
          verificationCode,
          verificationToken,
          verificationCodeExpires: Date.now() + 3600000,
        });
      }

      const verificationUrl = `http://${req.headers.host}/user/verify-email/${verificationToken}`;
      await sendEmail({
        to: email,
        subject: "Verify Your Blogify Account",
        html: `
          <h2>Welcome to Blogify!</h2>
          <p>Please verify your email by entering the following code on the verification page:</p>
          <h3>${verificationCode}</h3>
          <p>Or click the link below:</p>
          <a href="${verificationUrl}">Verify Email</a>
          <p>This code expires in 1 hour.</p>
        `,
      });

      return res.render("signup", {
        title: "Sign Up",
        user: req.user || null,
        success_msg: "Verification code sent to your email",
        error: null,
        showVerification: true,
        email,
        fullname,
        verificationToken,
        csrfToken: req.csrfToken(),
      });
    } catch (error) {
      return res.render("signup", {
        title: "Sign Up",
        user: req.user || null,
        error: error.message || "Error creating user",
        success_msg: null,
        showVerification: false,
        email,
        fullname,
        csrfToken: req.csrfToken(),
      });
    }
  }
);

// GET /user/verify-email/:token
router.get("/verify-email/:token", async (req, res) => {
  try {
    const user = await User.findOne({ verificationToken: req.params.token });
    if (!user) throw new Error("Invalid verification token");
    if (user.isVerified) throw new Error("Email already verified");
    if (user.verificationCodeExpires < Date.now()) throw new Error("Verification code expired");

    return res.render("signup", {
      title: "Sign Up",
      user: req.user || null,
      error: null,
      success_msg: "Please enter the verification code sent to your email",
      showVerification: true,
      email: user.email,
      fullname: user.fullname,
      verificationToken: req.params.token,
      csrfToken: req.csrfToken(),
    });
  } catch (error) {
    return res.redirect(`/user/signup?error_msg=${error.message || "Error verifying email"}`);
  }
});

// POST /user/verify-email/:token
router.post("/verify-email/:token", csrfProtection, async (req, res) => {
  const { code } = req.body;
  const { token } = req.params;

  try {
    const user = await User.findOne({ verificationToken: token });
    if (!user) throw new Error("Invalid verification token");
    if (user.isVerified) throw new Error("Email already verified");
    if (user.verificationCode !== code) throw new Error("Invalid verification code");
    if (user.verificationCodeExpires < Date.now()) throw new Error("Verification code expired");

    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationToken = undefined;
    user.verificationCodeExpires = undefined;
    await user.save();

    return res.redirect("/user/signin?success_msg=Email verified successfully");
  } catch (error) {
    return res.render("signup", {
      title: "Sign Up",
      user: req.user || null,
      error: error.message || "Error verifying email",
      success_msg: null,
      showVerification: true,
      email: req.query.email || "",
      fullname: req.query.fullname || "",
      verificationToken: token,
      csrfToken: req.csrfToken(),
    });
  }
});

// POST /user/signin
router.post("/signin", signInLimiter, validateSignin, csrfProtection, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render("signin", {
      title: "Sign In",
      user: req.user || null,
      error: errors.array()[0].msg,
      success_msg: null,
      csrfToken: req.csrfToken(),
    });
  }

  const { email, password } = req.body;
  try {
    const token = await User.matchPassword(email, password);
    return res
      .cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 24 * 60 * 60 * 1000, // 1 day
      })
      .redirect("/?success_msg=Signed in successfully");
  } catch (error) {
    return res.render("signin", {
      title: "Sign In",
      user: req.user || null,
      error: error.message || "Invalid credentials",
      success_msg: null,
      csrfToken: req.csrfToken(),
    });
  }
});

// GET /user/forgot-password
router.get("/forgot-password", csrfProtection, (req, res) => {
  return res.render("forgot-password", {
    title: "Forgot Password",
    user: req.user || null,
    error: req.query.error_msg,
    success_msg: req.query.success_msg,
    showPopup: false,
    email: "",
    userId: "",
    csrfToken: req.csrfToken(),
  });
});

// POST /user/forgot-password
router.post("/forgot-password", forgotPasswordLimiter, csrfProtection, async (req, res) => {
  const { email } = req.body;
  if (!validator.isEmail(email)) {
    return res.render("forgot-password", {
      title: "Forgot Password",
      user: req.user || null,
      error: "Invalid email address",
      success_msg: null,
      showPopup: false,
      email,
      userId: "",
      csrfToken: req.csrfToken(),
    });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) throw new Error("User not found");

    const resetToken = generateSecureToken();
    const resetCode = generateCode();
    user.resetPasswordToken = resetToken;
    user.resetPasswordCode = resetCode;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    const resetUrl = `http://${req.headers.host}/user/reset-password/${user._id}/${resetToken}`;
    await sendEmail({
      to: email,
      subject: "Blogify Password Reset",
      html: `
        <h2>Reset Your Blogify Password</h2>
        <p>Please enter the following code in the popup on the forgot password page:</p>
        <h3>${resetCode}</h3>
        <p>Or click the link below:</p>
        <a href="${resetUrl}">Reset Password</a>
        <p>This code expires in 1 hour.</p>
      `,
    });

    return res.render("forgot-password", {
      title: "Forgot Password",
      user: req.user || null,
      error: null,
      success_msg: "Password reset code sent to your email",
      showPopup: true,
      email,
      userId: user._id,
      csrfToken: req.csrfToken(),
    });
  } catch (error) {
    return res.render("forgot-password", {
      title: "Forgot Password",
      user: req.user || null,
      error: error.message || "Error sending reset code",
      success_msg: null,
      showPopup: false,
      email,
      userId: "",
      csrfToken: req.csrfToken(),
    });
  }
});

// POST /user/verify-reset-code/:id
router.post("/verify-reset-code/:id", csrfProtection, async (req, res) => {
  const { code } = req.body;
  const { id } = req.params;

  try {
    const user = await User.findById(id);
    if (!user) throw new Error("User not found");
    if (user.resetPasswordCode !== code) throw new Error("Invalid reset code");
    if (user.resetPasswordExpires < Date.now()) throw new Error("Reset code expired");

    return res.redirect(`/user/reset-password/${id}/${user.resetPasswordToken}`);
  } catch (error) {
    return res.render("forgot-password", {
      title: "Forgot Password",
      user: req.user || null,
      error: error.message || "Invalid or expired reset code",
      success_msg: null,
      showPopup: true,
      email: req.query.email || "",
      userId: id,
      csrfToken: req.csrfToken(),
    });
  }
});

// GET /user/reset-password/:id/:token
router.get("/reset-password/:id/:token", csrfProtection, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) throw new Error("User not found");
    if (user.resetPasswordToken !== req.params.token) throw new Error("Invalid reset token");
    if (user.resetPasswordExpires < Date.now()) throw new Error("Reset token expired");

    return res.render("reset-password", {
      title: "Reset Password",
      user: req.user || null,
      userId: req.params.id,
      token: req.params.token,
      error: req.query.error_msg,
      success_msg: req.query.success_msg,
      csrfToken: req.csrfToken(),
    });
  } catch (error) {
    return res.redirect(`/user/forgot-password?error_msg=${error.message || "Invalid or expired reset token"}`);
  }
});

// POST /user/reset-password/:id/:token
router.post(
  "/reset-password/:id/:token",
  csrfProtection,
  [
    body("password")
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
      .withMessage("Password must be at least 8 characters long and include uppercase, lowercase, number, and special character"),
    body("code").notEmpty().withMessage("Reset code is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render("reset-password", {
        title: "Reset Password",
        user: req.user || null,
        userId: req.params.id,
        token: req.params.token,
        error: errors.array()[0].msg,
        success_msg: null,
        csrfToken: req.csrfToken(),
      });
    }

    const { code, password } = req.body;
    const { id, token } = req.params;

    try {
      const user = await User.findById(id);
      if (!user) throw new Error("User not found");
      if (user.resetPasswordToken !== token || user.resetPasswordCode !== code) throw new Error("Invalid reset token or code");
      if (user.resetPasswordExpires < Date.now()) throw new Error("Reset token expired");

      user.password = password; // Password will be hashed in pre-save hook
      user.resetPasswordToken = undefined;
      user.resetPasswordCode = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      return res.redirect("/user/signin?success_msg=Password reset successfully");
    } catch (error) {
      return res.render("reset-password", {
        title: "Reset Password",
        user: req.user || null,
        userId: id,
        token,
        error: error.message || "Error resetting password",
        success_msg: null,
        csrfToken: req.csrfToken(),
      });
    }
  }
);

// GET /user/logout
router.get("/logout", (req, res) => {
  return res.clearCookie("token").redirect("/?success_msg=Logged out successfully");
});

// POST /user/follow/:id
router.post("/follow/:id", async (req, res) => {
  if (!req.user) {
    return res.redirect("/user/signin?error_msg=Please sign in to follow users");
  }

  const userIdToFollow = req.params.id;
  const currentUserId = req.user._id;

  if (userIdToFollow === currentUserId.toString()) {
    return res.redirect(`/?error_msg=You cannot follow yourself`);
  }

  try {
    const userToFollow = await User.findById(userIdToFollow);
    if (!userToFollow) {
      return res.redirect(`/?error_msg=User not found`);
    }

    const existingNotification = await Notification.findOne({
      sender: currentUserId,
      recipient: userIdToFollow,
      type: "FOLLOW_REQUEST",
      status: "PENDING",
    });

    if (existingNotification) {
      return res.redirect(`/?error_msg=Follow request already sent`);
    }

    await Notification.create({
      recipient: userIdToFollow,
      sender: currentUserId,
      type: "FOLLOW_REQUEST",
      message: `${req.user.fullname} wants to follow you`,
    });

    return res.redirect(`/profile/${userIdToFollow}?success_msg=Follow request sent to ${userToFollow.fullname}`);
  } catch (error) {
    console.error("Error sending follow request:", error);
    return res.redirect(`/?error_msg=Failed to send follow request`);
  }
});

// POST /user/unfollow/:id
router.post("/unfollow/:id", async (req, res) => {
  if (!req.user) {
    return res.redirect("/user/signin?error_msg=Please sign in to unfollow users");
  }

  const userIdToUnfollow = req.params.id;
  const currentUserId = req.user._id;

  if (userIdToUnfollow === currentUserId.toString()) {
    return res.redirect(`/?error_msg=You cannot unfollow yourself`);
  }

  try {
    const userToUnfollow = await User.findById(userIdToUnfollow);
    if (!userToUnfollow) {
      return res.redirect(`/?error_msg=User not found`);
    }

    await Promise.all([
      User.findByIdAndUpdate(currentUserId, { $pull: { following: userIdToUnfollow } }, { new: true }),
      User.findByIdAndUpdate(userIdToUnfollow, { $pull: { followers: currentUserId } }, { new: true }),
    ]);

    return res.redirect(`/profile/${userIdToUnfollow}?success_msg=Successfully unfollowed ${userToUnfollow.fullname}`);
  } catch (error) {
    console.error("Error unfollowing user:", error);
    return res.redirect(`/?error_msg=Failed to unfollow user`);
  }
});

module.exports = router;
