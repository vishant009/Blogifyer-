const { Router } = require("express");
const User = require("../models/user");
const Notification = require("../models/notification");
const { createTokenForUser } = require("../services/authentication");
const { sendEmail } = require("../middlewares/nodemailer");
const crypto = require("crypto");
const fetch = require("node-fetch");

const router = Router();

// Temporary in-memory store for pending signups
const pendingSignups = new Map();

// Generate 6-digit code
const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// GET /user/signin
router.get("/signin", (req, res) => {
  return res.render("signin", {
    title: "Sign In",
    user: req.user || null,
    error: req.query.error_msg,
    success_msg: req.query.success_msg,
  });
});

// GET /user/signup
router.get("/signup", (req, res) => {
  return res.render("signup", {
    title: "Sign Up",
    user: req.user || null,
    error: req.query.error_msg,
    success_msg: req.query.success_msg,
    showVerification: false,
    email: req.query.email || "",
    fullname: req.query.fullname || "",
  });
});

// POST /user/signup
router.post("/signup", async (req, res) => {
  const { fullname, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render("signup", {
        title: "Sign Up",
        user: req.user || null,
        error: "User with this email already exists",
        success_msg: null,
        showVerification: false,
        email,
        fullname,
      });
    }

    const verificationCode = generateCode();
    const signupToken = crypto.randomBytes(16).toString("hex");

    pendingSignups.set(signupToken, {
      fullname,
      email,
      password,
      verificationCode,
      verificationCodeExpires: Date.now() + 3600000,
    });

    const verificationUrl = `http://${req.headers.host}/user/verify-email/${signupToken}/${verificationCode}`;
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
      userId: signupToken,
      verificationCode,
    });
  } catch (error) {
    console.error("Signup error:", error);
    return res.render("signup", {
      title: "Sign Up",
      user: req.user || null,
      error: error.message || "Error during signup",
      success_msg: null,
      showVerification: false,
      email,
      fullname,
    });
  }
});

// GET /user/verify-email/:id/:code
router.get("/verify-email/:id/:code", async (req, res) => {
  const { id: signupToken, code } = req.params;
  try {
    const pendingUser = pendingSignups.get(signupToken);
    if (!pendingUser) throw new Error("Invalid or expired verification request");
    if (pendingUser.verificationCode !== code) throw new Error("Invalid verification code");
    if (pendingUser.verificationCodeExpires < Date.now()) throw new Error("Verification code expired");

    const user = await User.create({
      fullname: pendingUser.fullname,
      email: pendingUser.email,
      password: pendingUser.password,
      likedBlogs: [],
      bio: "",
      isVerified: true,
    });

    pendingSignups.delete(signupToken);

    return res.redirect("/user/signin?success_msg=Email verified successfully");
  } catch (error) {
    console.error("Verify email error:", error);
    return res.render("signup", {
      title: "Sign Up",
      user: req.user || null,
      error: error.message || "Error verifying email",
      success_msg: null,
      showVerification: true,
      email: pendingSignups.get(signupToken)?.email || req.query.email || "",
      fullname: pendingSignups.get(signupToken)?.fullname || req.query.fullname || "",
      userId: signupToken,
      verificationCode: code,
    });
  }
});

// POST /user/verify-email/:id/:code
router.post("/verify-email/:id/:code", async (req, res) => {
  const { code } = req.body;
  const { id: signupToken } = req.params;

  try {
    const pendingUser = pendingSignups.get(signupToken);
    if (!pendingUser) throw new Error("Invalid or expired verification request");
    if (pendingUser.verificationCode !== code) throw new Error("Invalid verification code");
    if (pendingUser.verificationCodeExpires < Date.now()) throw new Error("Verification code expired");

    const user = await User.create({
      fullname: pendingUser.fullname,
      email: pendingUser.email,
      password: pendingUser.password,
      likedBlogs: [],
      bio: "",
      isVerified: true,
    });

    pendingSignups.delete(signupToken);

    return res.redirect("/user/signin?success_msg=Email verified successfully");
  } catch (error) {
    console.error("Verify email error:", error);
    return res.render("signup", {
      title: "Sign Up",
      user: req.user || null,
      error: error.message || "Error verifying email",
      success_msg: null,
      showVerification: true,
      email: pendingSignups.get(signupToken)?.email || req.query.email || "",
      fullname: pendingSignups.get(signupToken)?.fullname || req.query.fullname || "",
      userId: signupToken,
      verificationCode: code,
    });
  }
});

// POST /user/signin
router.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  try {
    const token = await User.matchPassword(email, password);
    return res
      .cookie("token", token, { httpOnly: true })
      .redirect("/?success_msg=Signed in successfully");
  } catch (error) {
    console.error("Signin error:", error);
    return res.render("signin", {
      title: "Sign In",
      user: req.user || null,
      error: error.message || "Invalid credentials",
      success_msg: null,
    });
  }
});

// GET /user/forgot-password
router.get("/forgot-password", (req, res) => {
  return res.render("forgot-password", {
    title: "Forgot Password",
    user: req.user || null,
    error: req.query.error_msg,
    success_msg: req.query.success_msg,
    showPopup: false,
    email: "",
    userId: "",
  });
});

// POST /user/forgot-password
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) throw new Error("User not found");

    const resetCode = generateCode();
    user.resetPasswordToken = resetCode;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const resetUrl = `http://${req.headers.host}/user/reset-password/${user._id}/${resetCode}`;
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
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.render("forgot-password", {
      title: "Forgot Password",
      user: req.user || null,
      error: error.message || "Error sending reset code",
      success_msg: null,
      showPopup: false,
      email,
      userId: "",
    });
  }
});

// POST /user/verify-reset-code/:id
router.post("/verify-reset-code/:id", async (req, res) => {
  const { code } = req.body;
  const { id } = req.params;

  try {
    const user = await User.findById(id);
    if (!user) throw new Error("User not found");
    if (user.resetPasswordToken !== code) throw new Error("Invalid reset code");
    if (user.resetPasswordExpires < Date.now()) throw new Error("Reset code expired");

    return res.redirect(`/user/reset-password/${id}/${code}`);
  } catch (error) {
    console.error("Verify reset code error:", error);
    return res.render("forgot-password", {
      title: "Forgot Password",
      user: req.user || null,
      error: error.message || "Invalid or expired reset code",
      success_msg: null,
      showPopup: true,
      email: req.query.email || "",
      userId: id,
    });
  }
});

// GET /user/reset-password/:id/:code
router.get("/reset-password/:id/:code", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) throw new Error("User not found");
    if (user.resetPasswordToken !== req.params.code) throw new Error("Invalid reset code");
    if (user.resetPasswordExpires < Date.now()) throw new Error("Reset code expired");

    return res.render("reset-password", {
      title: "Reset Password",
      user: req.user || null,
      userId: req.params.id,
      code: req.params.code,
      error: req.query.error_msg,
      success_msg: req.query.success_msg,
    });
  } catch (error) {
    console.error("Reset password GET error:", error);
    return res.redirect(`/user/forgot-password?error_msg=${error.message || "Invalid or expired reset code"}`);
  }
});

// POST /user/reset-password/:id/:code
router.post("/reset-password/:id/:code", async (req, res) => {
  const { code, password } = req.body;
  const { id } = req.params;

  try {
    const user = await User.findById(id);
    if (!user) throw new Error("User not found");
    if (user.resetPasswordToken !== code) throw new Error("Invalid reset code");
    if (user.resetPasswordExpires < Date.now()) throw new Error("Reset code expired");

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.redirect("/user/signin?success_msg=Password reset successfully");
  } catch (error) {
    console.error("Reset password POST error:", error);
    return res.render("reset-password", {
      title: "Reset Password",
      user: req.user || null,
      userId: id,
      code,
      error: error.message || "Error resetting password",
      success_msg: null,
    });
  }
});

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

    const isFollowing = userToFollow.followers.includes(currentUserId);
    if (isFollowing) {
      return res.redirect(`/profile/${userIdToFollow}?error_msg=You are already following ${userToFollow.fullname}`);
    }

    const existingNotification = await Notification.findOne({
      sender: currentUserId,
      recipient: userIdToFollow,
      type: "FOLLOW_REQUEST",
      status: "PENDING",
    });

    if (existingNotification) {
      return res.redirect(`/profile/${userIdToFollow}?error_msg=Follow request already sent`);
    }

    await Notification.create({
      recipient: userIdToFollow,
      sender: currentUserId,
      type: "FOLLOW_REQUEST",
      message: `${req.user.fullname} wants to follow you`,
      status: "PENDING",
      isRead: false,
    });

    await fetch(`http://${req.headers.host}/notificationPush/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "FOLLOW_REQUEST",
        senderId: currentUserId,
        recipientId: userIdToFollow,
      }),
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

    await Notification.findOneAndDelete({
      sender: currentUserId,
      recipient: userIdToUnfollow,
      type: "FOLLOW_REQUEST",
      status: "PENDING",
    });

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
