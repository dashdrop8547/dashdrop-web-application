const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const itemSchema = new Schema({
  name:        { type: String, required: true },
  description: { type: String, default: '' },
  fileUrl:     { type: String, default: null },
  owner:       { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('Item', itemSchema);
