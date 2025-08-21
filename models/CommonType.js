const mongoose = require('mongoose');

const CommonTypeSchema = new mongoose.Schema({
  Value: {
    type: String,
    required: true
  },
  Code: {
    type: Number,
    required: true
  },
  MasterType: {
    type: String,
    required: true
  },
  Description: {
    type: String
  }
});

module.exports = mongoose.model('CommonType', CommonTypeSchema); 