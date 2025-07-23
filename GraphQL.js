const { gql } = require('apollo-server');

const typeDefs = gql`
  type User {
    _id: ID!
    fullname: String!
    email: String!
    profileImageURL: String
    role: String!
    following: [User]
    followers: [User]
    likedBlogs: [Blog]
    bio: String
    isVerified: Boolean
    blogPermissions: BlogPermissions
  }

  type BlogPermissions {
    likes: String!
    comments: String!
  }

  type Blog {
    _id: ID!
    title: String!
    body: String!
    coverImage: String
    createdBy: User!
    likes: [User]
    createdAt: String!
  }

  type Comment {
    _id: ID!
    content: String!
    createdBy: User!
    blogId: Blog!
    likes: [User]
    createdAt: String!
  }

  type Notification {
    _id: ID!
    recipient: User!
    sender: User!
    type: String!
    blogId: Blog
    message: String!
    coverImage: String
    status: String!
    isRead: Boolean!
    createdAt: String!
  }

  type Query {
    me: User
    user(id: ID!): User
    users: [User]
    blog(id: ID!): Blog
    blogs: [Blog]
    comments(blogId: ID!): [Comment]
    notifications: [Notification]
    unreadNotificationCount: Int
  }

  type Mutation {
    signup(fullname: String!, email: String!, password: String!): AuthPayload
    signin(email: String!, password: String!): AuthPayload
    updateProfile(fullname: String, bio: String, likePermissions: String, commentPermissions: String): User
    createBlog(title: String!, body: String!, coverImage: String): Blog
    likeBlog(blogId: ID!): Blog
    createComment(blogId: ID!, content: String!): Comment
    likeComment(commentId: ID!): Comment
    followUser(userId: ID!): Boolean
    acceptFollowRequest(notificationId: ID!): Boolean
    rejectFollowRequest(notificationId: ID!): Boolean
    markNotificationAsRead(notificationId: ID!): Boolean
  }

  type AuthPayload {
    token: String!
    user: User!
  }
`;

module.exports = typeDefs;
