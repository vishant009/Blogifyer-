// models/notificationPush.js
const { Schema, model } = require("mongoose");

const pushSchema = new Schema(
  {
    userId:      { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    subscription:{           // Web-push subscription object
      endpoint:  { type: String, required: true },
      keys: {
        p256dh:  { type: String, required: true },
        auth:    { type: String, required: true }
      }
    }
  },
  { timestamps: true }
);

module.exports = model("PushNotification", pushSchema);
