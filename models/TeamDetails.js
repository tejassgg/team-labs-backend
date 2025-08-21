const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const TeamDetailsSchema = new mongoose.Schema({
  TeamDetailsID: {
    type: String,
    default: uuidv4,
    unique: true
  },
  TeamID_FK: {
    type: String,
    required: true
  },
  MemberID: {
    type: String,
    required: true
  },
  IsMemberActive: {
    type: Boolean,
    default: true
  },
  CreatedDate: {
    type: Date,
    default: Date.now
  },
  ModifiedDate: {
    type: Date
  },
  ModifiedBy: {
    type: String
  }
});

module.exports = mongoose.model('TeamDetails', TeamDetailsSchema); 