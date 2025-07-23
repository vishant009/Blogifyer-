const { Schema, model } = require("mongoose");

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["FOLLOW_REQUEST", "NEW_BLOG", "LIKE", "NEW_COMMENT", "LIKE_COMMENT"],
      required: true,
    },
    blogId: { type: Schema.Types.ObjectId, ref: "Blog" },
    message: { type: String, required: true },
    status: { type: String, enum: ["PENDING", "ACCEPTED", "REJECTED", "READ"], default: "PENDING" },
    isRead: { type: Boolean, default: false },
    coverImage: { type: String }, // Added for blog cover image
  },
  { timestamps: true }
);

module.exports = model("Notification", notificationSchema);
