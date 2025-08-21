const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // Payment Details
  paymentId: {
    type: String,
    required: true,
    unique: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'USD'
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  
  // Subscription Details
  plan: {
    type: String,
    enum: ['free', 'monthly', 'annual'],
    required: true
  },
  billingCycle: {
    type: String,
    enum: ['free', 'monthly', 'annual'],
    required: true
  },
  
  // Payment Method
  paymentMethod: {
    type: String,
    enum: ['card', 'bank'],
    required: true
  },
  
  // Card Details (encrypted)
  cardDetails: {
    last4: String,
    brand: String,
    expiryMonth: String,
    expiryYear: String,
    cardHolderName: String
  },
  
  // Bank Details (encrypted)
  bankDetails: {
    bankName: String,
    accountLast4: String,
    routingNumber: String,
    accountHolderName: String
  },
  
  // Billing Address
  billingAddress: {
    address: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  
  // Organization and User
  organizationID: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Subscription Period
  subscriptionStartDate: {
    type: Date,
    default: Date.now
  },
  subscriptionEndDate: {
    type: Date,
    required: true
  },
  
  // Auto-renewal
  autoRenew: {
    type: Boolean,
    default: true
  },
  savePaymentMethod: {
    type: Boolean,
    default: false
  },
  
  // Transaction Details
  transactionId: String,
  gatewayResponse: Object,
  
  // Refund tracking
  originalPaymentId: {
    type: String,
    ref: 'Payment'
  },
  refundedPaymentId: {
    type: String,
    ref: 'Payment'
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better query performance
paymentSchema.index({ organizationID: 1, status: 1 });
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ paymentId: 1 });
paymentSchema.index({ createdAt: -1 });

// Virtual for subscription status
paymentSchema.virtual('isActive').get(function() {
  return this.status === 'completed' && new Date() <= this.subscriptionEndDate;
});

// Virtual for days remaining
paymentSchema.virtual('daysRemaining').get(function() {
  if (this.status !== 'completed') return 0;
  const now = new Date();
  const end = new Date(this.subscriptionEndDate);
  const diffTime = end - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
});

// Pre-save middleware to set subscription end date
paymentSchema.pre('save', function(next) {
  if (this.isNew && this.status === 'completed' && !this.subscriptionEndDate) {
    const startDate = new Date();
    const endDate = new Date(startDate);
    
    if (this.billingCycle === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (this.billingCycle === 'annual') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }
    
    this.subscriptionEndDate = endDate;
  }
  next();
});

// Static method to get active subscription
paymentSchema.statics.getActiveSubscription = function(organizationID) {
  return this.findOne({
    organizationID: organizationID,
    status: 'completed',
    subscriptionEndDate: { $gte: new Date() }
  }).sort({ createdAt: -1 });
};

// Static method to get payment history
paymentSchema.statics.getPaymentHistory = function(organizationID, limit = 10) {
  return this.find({
    organizationID: organizationID
  })
  .sort({ createdAt: -1 })
  .limit(limit)
  .populate('userId', 'name email');
};

// Static method to create downgrade refund
paymentSchema.statics.createDowngradeRefund = async function(originalPayment, newPlan, userId) {
  try {
    // Calculate refund amount based on remaining time
    const now = new Date();
    const originalEndDate = new Date(originalPayment.subscriptionEndDate);
    const totalDays = Math.ceil((originalEndDate - originalPayment.subscriptionStartDate) / (1000 * 60 * 60 * 24));
    const remainingDays = Math.ceil((originalEndDate - now) / (1000 * 60 * 60 * 24));
    
    // Calculate refund amount (proportional to remaining time)
    const refundAmount = Math.round((originalPayment.amount / totalDays) * remainingDays);
    
    // Create refund payment record
    const refundPayment = new this({
      paymentId: `REFUND_${originalPayment.paymentId}_${Date.now()}`,
      amount: -refundAmount, // Negative amount to indicate refund
      currency: originalPayment.currency,
      status: 'refunded',
      plan: originalPayment.plan,
      billingCycle: originalPayment.billingCycle,
      paymentMethod: originalPayment.paymentMethod,
      organizationID: originalPayment.organizationID,
      userId: userId,
      subscriptionStartDate: now,
      subscriptionEndDate: originalPayment.subscriptionEndDate, // Keep original end date
      autoRenew: false,
      savePaymentMethod: false,
      transactionId: `REFUND_${originalPayment.transactionId}`,
      gatewayResponse: {
        refundReason: 'downgrade',
        originalPaymentId: originalPayment.paymentId,
        newPlan: newPlan,
        refundAmount: refundAmount,
        remainingDays: remainingDays
      },
      originalPaymentId: originalPayment.paymentId,
      refundedPaymentId: originalPayment.paymentId
    });

    await refundPayment.save();
    
    // Update original payment to mark as refunded
    originalPayment.status = 'refunded';
    originalPayment.gatewayResponse = {
      ...originalPayment.gatewayResponse,
      refundedAt: now,
      refundAmount: refundAmount,
      downgradeTo: newPlan
    };
    await originalPayment.save();

    return {
      refundPayment,
      refundAmount,
      remainingDays
    };
  } catch (error) {
    console.error('Error creating downgrade refund:', error);
    throw error;
  }
};

// Static method to check if downgrade is eligible for refund
paymentSchema.statics.isEligibleForDowngradeRefund = function(payment) {
  // Only annual plans are eligible for refund on downgrade
  if (payment.plan !== 'annual' || payment.status !== 'completed') {
    return false;
  }
  
  // Check if subscription is still active
  const now = new Date();
  if (now >= payment.subscriptionEndDate) {
    return false;
  }
  
  // Check if there are at least 7 days remaining (minimum refund period)
  const remainingDays = Math.ceil((payment.subscriptionEndDate - now) / (1000 * 60 * 60 * 24));
  return remainingDays >= 7;
};

module.exports = mongoose.model('Payment', paymentSchema); 