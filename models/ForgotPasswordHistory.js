const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const ForgotPasswordHistorySchema = new mongoose.Schema({
  Username: { type: String, required: true },
  AttemptNo: { type: Number, required: true, default: 1 },
  MaxNoOfAttempts: { type: Number, required: true, default: 3 },
  Key: { type: String, required: true, default: uuidv4 }, // UUID
  ExpiryTime: { type: Date, required: true },
  Link: { type: String, required: true },
  PasswordChangedDate: { type: Date, default: null },
  IsValid: { type: Boolean, default: null },
}, {
  timestamps: { createdAt: 'CreatedDate', updatedAt: false }
});

module.exports = mongoose.model('ForgotPasswordHistory', ForgotPasswordHistorySchema); 