const { createTokenForUser } = require('../services/authentication');
const User = require('../models/user');
const Blog = require('../models/blog');
const Comment = require('../models/comments');
const Notification = require('../models/notification');
const fetch = require('node-fetch');

const resolvers = {
  Query: {
    me: async (_, __, { user }) => {
      if (!user) throw new Error("Please log in");
      return await User.findById(user._id)
        .populate('following')
        .populate('followers')
        .populate('likedBlogs');
    },
    user: async (_, { id }) => {
      return await User.findById(id)
        .populate('following')
        .populate('followers')
        .populate('likedBlogs');
    },
    users: async () => {
      return await User.find()
        .populate('following')
        .populate('followers')
        .populate('likedBlogs');
    },
    blog: async (_, { id }) => {
      return await Blog.findById(id)
        .populate('createdBy')
        .populate('likes');
    },
    blogs: async () => {
      return await Blog.find()
        .populate('createdBy')
        .populate('likes')
        .sort({ createdAt: -1 });
    },
    comments: async (_, { blogId }) => {
      return await Comment.find({ blogId })
        .populate('createdBy')
        .populate('likes')
        .sort({ createdAt: -1 });
    },
    notifications: async (_, __, { user }) => {
      if (!user) throw new Error("Please log in");
      return await Notification.find({ recipient: user._id })
        .populate('sender')
        .populate('blogId')
        .sort({ createdAt: -1 });
    },
    unreadNotificationCount: async (_, __, { user }) => {
      if (!user) throw new Error("Please log in");
      return await Notification.countDocuments({
        recipient: user._id,
        status: "PENDING",
        isRead: false,
      });
    },
  },
  Mutation: {
    signup: async (_, { fullname, email, password }) => {
      const existingUser = await User.findOne({ email });
      if (existingUser) throw new Error("User with this email already exists");

      const user = await User.create({
        fullname,
        email,
        password,
        likedBlogs: [],
        bio: "",
        isVerified: true, // Simplified for GraphQL, adjust for email verification if needed
      });

      const token = createTokenForUser(user);
      return { token, user };
    },
    signin: async (_, { email, password }) => {
      const token = await User.matchPassword(email, password);
      const user = await User.findOne({ email })
        .populate('following')
        .populate('followers')
        .populate('likedBlogs');
      return { token, user };
    },
    updateProfile: async (_, { fullname, bio, likePermissions, commentPermissions }, { user }) => {
      if (!user) throw new Error("Please log in");

      const update = {};
      if (fullname?.trim()) update.fullname = fullname.trim();
      if (bio?.trim()) update.bio = bio.trim();
      if (likePermissions && ["everyone", "followers", "following"].includes(likePermissions)) {
        update["blogPermissions.likes"] = likePermissions;
      }
      if (commentPermissions && ["everyone", "followers", "following"].includes(commentPermissions)) {
        update["blogPermissions.comments"] = commentPermissions;
      }

      if (!Object.keys(update).length) throw new Error("No changes provided");

      return await User.findByIdAndUpdate(user._id, update, { new: true })
        .populate('following')
        .populate('followers')
        .populate('likedBlogs');
    },
    createBlog: async (_, { title, body, coverImage }, { user }) => {
      if (!user) throw new Error("Please log in");

      const blog = await Blog.create({
        title: title.trim(),
        body: body.trim(),
        coverImage,
        createdBy: user._id,
        likes: [],
      });

      await fetch(`http://localhost:${process.env.PORT}/notificationPush/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "NEW_BLOG",
          blogId: blog._id,
          senderId: user._id,
        }),
      });

      return await Blog.findById(blog._id)
        .populate('createdBy')
        .populate('likes');
    },
    likeBlog: async (_, { blogId }, { user }) => {
      if (!user) throw new Error("Please log in");

      const blog = await Blog.findById(blogId).populate("createdBy", "blogPermissions followers following");
      if (!blog) throw new Error("Blog not found");

      // Check permissions
      const blogOwner = blog.createdBy;
      if (blogOwner.blogPermissions.likes === "followers" && !blogOwner.followers.some(f => f._id.equals(user._id))) {
        throw new Error("You must be a follower to like this blog");
      } else if (blogOwner.blogPermissions.likes === "following" && !blogOwner.following.some(f => f._id.equals(user._id))) {
        throw new Error("The blog owner must be following you to like this blog");
      }

      const isLiked = blog.likes.includes(user._id);
      if (isLiked) {
        blog.likes = blog.likes.filter((id) => !id.equals(user._id));
      } else {
        blog.likes.push(user._id);
        await fetch(`http://localhost:${process.env.PORT}/notificationPush/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "LIKE_BLOG",
            blogId: blog._id,
            senderId: user._id,
            recipientId: blog.createdBy._id,
          }),
        });
      }

      await blog.save();
      return await Blog.findById(blogId)
        .populate('createdBy')
        .populate('likes');
    },
    createComment: async (_, { blogId, content }, { user }) => {
      if (!user) throw new Error("Please log in");

      const blog = await Blog.findById(blogId).populate("createdBy", "blogPermissions followers following");
      if (!blog) throw new Error("Blog not found");

      // Check permissions
      const blogOwner = blog.createdBy;
      if (blogOwner.blogPermissions.comments === "followers" && !blogOwner.followers.some(f => f._id.equals(user._id))) {
        throw new Error("You must be a follower to comment on this blog");
      } else if (blogOwner.blogPermissions.comments === "following" && !blogOwner.following.some(f => f._id.equals(user._id))) {
        throw new Error("The blog owner must be following you to comment on this blog");
      }

      const comment = await Comment.create({
        content: content.trim(),
        blogId,
        createdBy: user._id,
        likes: [],
      });

      await fetch(`http://localhost:${process.env.PORT}/notificationPush/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "NEW_COMMENT",
          commentId: comment._id,
          senderId: user._id,
          recipientId: blog.createdBy._id,
        }),
      });

      return await Comment.findById(comment._id)
        .populate('createdBy')
        .populate('likes')
        .populate('blogId');
    },
    likeComment: async (_, { commentId }, { user }) => {
      if (!user) throw new Error("Please log in");

      const comment = await Comment.findById(commentId).populate("blogId", "createdBy");
      if (!comment || !comment.blogId) throw new Error("Comment not found");

      // Check permissions
      const blogOwner = await User.findById(comment.blogId.createdBy);
      if (blogOwner.blogPermissions.comments === "followers" && !blogOwner.followers.some(f => f._id.equals(user._id))) {
        throw new Error("You must be a follower to like comments on this blog");
      } else if (blogOwner.blogPermissions.comments === "following" && !blogOwner.following.some(f => f._id.equals(user._id))) {
        throw new Error("The blog owner must be following you to like comments on this blog");
      }

      const isLiked = comment.likes.includes(user._id);
      if (isLiked) {
        comment.likes = comment.likes.filter((id) => !id.equals(user._id));
      } else {
        comment.likes.push(user._id);
        await fetch(`http://localhost:${process.env.PORT}/notificationPush/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "LIKE_COMMENT",
            commentId: comment._id,
            senderId: user._id,
            recipientId: comment.createdBy,
          }),
        });
      }

      await comment.save();
      return await Comment.findById(commentId)
        .populate('createdBy')
        .populate('likes')
        .populate('blogId');
    },
    followUser: async (_, { userId }, { user }) => {
      if (!user) throw new Error("Please log in");
      if (userId === user._id.toString()) throw new Error("Cannot follow yourself");

      const userToFollow = await User.findById(userId);
      if (!userToFollow) throw new Error("User not found");

      const isFollowing = userToFollow.followers.includes(user._id);
      if (isFollowing) throw new Error("Already following this user");

      await fetch(`http://localhost:${process.env.PORT}/notificationPush/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "FOLLOW_REQUEST",
          senderId: user._id,
          recipientId: userId,
        }),
      });

      return true;
    },
    acceptFollowRequest: async (_, { notificationId }, { user }) => {
      if (!user) throw new Error("Please log in");

      const notification = await Notification.findById(notificationId).populate("sender");
      if (!notification || notification.recipient.toString() !== user._id.toString()) {
        throw new Error("Notification not found or unauthorized");
      }
      if (notification.type !== "FOLLOW_REQUEST" || notification.status !== "PENDING") {
        throw new Error("Invalid or already processed notification");
      }

      await Promise.all([
        User.findByIdAndUpdate(user._id, { $addToSet: { followers: notification.sender._id } }, { new: true }),
        User.findByIdAndUpdate(notification.sender._id, { $addToSet: { following: user._id } }, { new: true }),
        Notification.findByIdAndUpdate(notificationId, { status: "ACCEPTED", isRead: true }, { new: true }),
      ]);

      return true;
    },
    rejectFollowRequest: async (_, { notificationId }, { user }) => {
      if (!user) throw new Error("Please log in");

      const notification = await Notification.findById(notificationId);
      if (!notification || notification.recipient.toString() !== user._id.toString()) {
        throw new Error("Notification not found or unauthorized");
      }
      if (notification.type !== "FOLLOW_REQUEST" || notification.status !== "PENDING") {
        throw new Error("Invalid or already processed notification");
      }

      await Notification.findByIdAndUpdate(notificationId, { status: "REJECTED", isRead: true }, { new: true });
      return true;
    },
    markNotificationAsRead: async (_, { notificationId }, { user }) => {
      if (!user) throw new Error("Please log in");

      const notification = await Notification.findById(notificationId);
      if (!notification || notification.recipient.toString() !== user._id.toString()) {
        throw new Error("Notification not found or unauthorized");
      }

      await Notification.findByIdAndUpdate(notificationId, { status: "READ", isRead: true }, { new: true });
      return true;
    },
  },
};

module.exports = resolvers;
