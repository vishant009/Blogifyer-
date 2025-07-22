const { Schema, model } = require("mongoose");

const pushNotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    subscription: {
      type: {
        endpoint: { type: String, required: true },
        expirationTime: { type: Date, default: null },
        keys: {
          p256dh: { type: String, required: true },
          auth: { type: String, required: true },
        },
      },
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = model("PushNotification", pushNotificationSchema);
