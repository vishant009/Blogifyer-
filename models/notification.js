// models/notification.js
const { Schema, model } = require("mongoose");

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User" },
    type: { type: String, enum: ["NEW_BLOG", "LIKE", "NEW_COMMENT", "LIKE_COMMENT", "FOLLOW_REQUEST"], required: true },
    message: { type: String, required: true },
    blogId: { type: Schema.Types.ObjectId, ref: "Blog" },
    status: { type: String, enum: ["PENDING", "ACCEPTED", "REJECTED", "READ"], default: "PENDING" },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = model("Notification", notificationSchema);
