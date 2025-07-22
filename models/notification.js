const { Schema, model } = require("mongoose");

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["FOLLOW_REQUEST", "LIKE", "NEW_BLOG", "NEW_COMMENT", "LIKE_COMMENT"],
      required: true,
    },
    blogId: { type: Schema.Types.ObjectId, ref: "Blog", default: null },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "REJECTED", "READ"],
      default: "PENDING",
    },
    message: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = model("Notification", notificationSchema);
