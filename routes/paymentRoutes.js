const express = require('express');
const router = express.Router();
const { 
  processPayment, 
  getPaymentHistory, 
  getSubscriptionStatus, 
  cancelSubscription,
  downgradeSubscription,
  calculateDowngradeRefund,
  upgradeSubscription,
  getOrganizationPaymentData
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

// Process payment
router.post('/process', protect, processPayment);

// Get payment history for organization
router.get('/history/:organizationID', protect, getPaymentHistory);

// Get subscription status
router.get('/subscription/:organizationID', protect, getSubscriptionStatus);

// Get all payment data for organization (subscription + history)
router.get('/organization/:organizationID', protect, getOrganizationPaymentData);

// Cancel subscription
router.post('/cancel/:organizationID', protect, cancelSubscription);

// Downgrade subscription
router.post('/downgrade/:organizationID', protect, downgradeSubscription);

// Calculate refund amount for downgrade
router.get('/calculate-refund/:organizationID', protect, calculateDowngradeRefund);

// Upgrade subscription
router.post('/upgrade/:organizationID', protect, upgradeSubscription);

module.exports = router; 