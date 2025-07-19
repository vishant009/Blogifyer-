// models/comments.js
const { Schema, model } = require('mongoose');

const commentSchema = new Schema(
  {
    content: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    blogId: { type: Schema.Types.ObjectId, ref: 'Blog' },
    parentCommentId: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },
    replies: [{ type: Schema.Types.ObjectId, ref: 'Comment' }],
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }]
  },
  { timestamps: true }
);

commentSchema.pre('save', async function (next) {
  if (this.parentCommentId) {
    await Comment.findByIdAndUpdate(this.parentCommentId, { $addToSet: { replies: this._id } });
  }
  next();
});

module.exports = model('Comment', commentSchema);
