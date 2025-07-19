const { Schema, model } = require('mongoose');

const blogSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    coverImage: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    category: {
      type: String,
      enum: ['Technology', 'Lifestyle', 'Education', 'Travel', 'Food', 'Other'],
      default: 'Other'
    },
    tags: [{ type: String, trim: true }],
    status: { type: String, enum: ['draft', 'published'], default: 'published' }
  },
  { timestamps: true }
);

module.exports = model('Blog', blogSchema);
