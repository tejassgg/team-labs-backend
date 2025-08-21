const Payment = require('../models/Payment');
const User = require('../models/User');
const CommonType = require('../models/CommonType');
const Organization = require('../models/Organization');

// Generate unique payment ID
const generatePaymentId = () => {
  return `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
};

// Helper to check if user is admin of the organization
const isOrgAdmin = async (organizationID, userId) => {
  const org = await Organization.findOne({ OrganizationID: organizationID });
  if (!org) return false;
  return org.OwnerID.toString() === userId.toString();
};

// Process payment and activate subscription
const processPayment = async (req, res) => {
  try {
    const {
      plan,
      amount,
      paymentMethod,
      organizationID,
      userId,
      saveCard,
      // Card details
      cardNumber,
      cardHolderName,
      expiryMonth,
      expiryYear,
      cvv,
      billingAddress,
      city,
      state,
      zipCode,
      country,
      // Bank details
      bankName,
      accountNumber,
      routingNumber,
      accountHolderName
    } = req.body;

    // Validate required fields
    if (!plan || !amount || !paymentMethod || !organizationID || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Generate payment ID
    const paymentId = generatePaymentId();

    // Calculate subscription end date
    const subscriptionStartDate = new Date();
    const subscriptionEndDate = new Date(subscriptionStartDate);
    
    if (plan === 'monthly') {
      subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);
    } else if (plan === 'annual') {
      subscriptionEndDate.setFullYear(subscriptionEndDate.getFullYear() + 1);
    }

    // Create payment record
    const paymentData = {
      paymentId,
      amount,
      plan,
      billingCycle: plan,
      paymentMethod,
      organizationID,
      userId,
      savePaymentMethod: saveCard,
      status: 'pending',
      subscriptionStartDate,
      subscriptionEndDate
    };

    // Add payment method details
    if (paymentMethod === 'card') {
      paymentData.cardDetails = {
        last4: cardNumber.slice(-4),
        brand: getCardBrand(cardNumber),
        expiryMonth,
        expiryYear,
        cardHolderName
      };
      paymentData.billingAddress = {
        address: billingAddress,
        city,
        state,
        zipCode,
        country
      };
    } else if (paymentMethod === 'bank') {
      paymentData.bankDetails = {
        bankName,
        accountLast4: accountNumber.slice(-4),
        routingNumber,
        accountHolderName
      };
    }

    // Simulate payment processing (replace with actual payment gateway)
    const paymentResult = await simulatePaymentProcessing(paymentData);
    
    if (paymentResult.success) {
      // Update payment status
      paymentData.status = 'completed';
      paymentData.transactionId = paymentResult.transactionId;
      paymentData.gatewayResponse = paymentResult.response;

      // Create payment record
      const payment = new Payment(paymentData);
      await payment.save();

      // Activate premium subscription for all users in organization
      await activateOrganizationPremium(organizationID, plan);

      // Save payment method if requested
      if (saveCard && paymentMethod === 'card') {
        await saveUserPaymentMethod(userId, paymentMethod, paymentData.cardDetails);
      }

      res.json({
        success: true,
        message: 'Payment processed successfully',
        paymentId,
        transactionId: paymentResult.transactionId
      });
    } else {
      // Payment failed
      paymentData.status = 'failed';
      paymentData.gatewayResponse = paymentResult.response;

      const payment = new Payment(paymentData);
      await payment.save();

      res.status(400).json({
        success: false,
        message: paymentResult.message || 'Payment failed'
      });
    }
  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get payment history for organization
const getPaymentHistory = async (req, res) => {
  try {
    const { organizationID } = req.params;
    const { limit = 10, page = 1 } = req.query;

    const skip = (page - 1) * limit;
    
    const payments = await Payment.getPaymentHistory(organizationID, parseInt(limit));
    const total = await Payment.countDocuments({ organizationID });

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          hasNext: skip + payments.length < total,
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get subscription status
const getSubscriptionStatus = async (req, res) => {
  try {
    const { organizationID } = req.params;

    const activeSubscription = await Payment.getActiveSubscription(organizationID);
    const premiumUsers = await User.getPremiumUsers(organizationID);

    res.json({
      success: true,
      data: {
        hasActiveSubscription: !!activeSubscription,
        subscription: activeSubscription,
        premiumUsersCount: premiumUsers.length,
        premiumUsers: premiumUsers.map(user => ({
          id: user._id,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          subscriptionEndDate: user.subscriptionEndDate
        }))
      }
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Cancel subscription
const cancelSubscription = async (req, res) => {
  try {
    const { organizationID } = req.params;
    const { userId } = req.body;

    // Find active subscription
    const activeSubscription = await Payment.getActiveSubscription(organizationID);
    
    if (!activeSubscription) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found'
      });
    }

    // Admin check
    const isAdmin = await isOrgAdmin(organizationID, userId);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Only the organization admin can cancel the subscription.' });
    }

    // Update subscription to not auto-renew
    activeSubscription.autoRenew = false;
    await activeSubscription.save();

    // Deactivate premium for all users in organization
    await deactivateOrganizationPremium(organizationID);

    res.json({
      success: true,
      message: 'Subscription cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Downgrade subscription
const downgradeSubscription = async (req, res) => {
  try {
    const { organizationID } = req.params;
    const { newPlan, userId } = req.body;

    // Validate new plan
    if (!['monthly', 'free'].includes(newPlan)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid new plan. Must be "monthly" or "free"'
      });
    }

    // Find active subscription
    const activeSubscription = await Payment.getActiveSubscription(organizationID);
    
    if (!activeSubscription) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found'
      });
    }

    // Admin check
    const isAdmin = await isOrgAdmin(organizationID, userId);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Only the organization admin can downgrade the subscription.' });
    }

    let refundResult = null;

    // Process refund for downgrade to free plan (any plan to free)
    if (newPlan === 'free') {
      // Check if eligible for refund (any active plan can be refunded when downgrading to free)
      if (activeSubscription.status !== 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Subscription is not eligible for refund. Must be an active completed subscription.'
        });
      }

      // Check if subscription is still active
      const now = new Date();
      if (now >= activeSubscription.subscriptionEndDate) {
        return res.status(400).json({
          success: false,
          message: 'Subscription has already expired.'
        });
      }

      // Check if there are at least 1 day remaining (minimum refund period)
      const remainingDays = Math.ceil((activeSubscription.subscriptionEndDate - now) / (1000 * 60 * 60 * 24));
      if (remainingDays < 1) {
        return res.status(400).json({
          success: false,
          message: 'Subscription is not eligible for refund. Must have at least 1 day remaining.'
        });
      }

      try {
        refundResult = await Payment.createDowngradeRefund(activeSubscription, newPlan, userId);
      } catch (refundError) {
        console.error('Refund processing error:', refundError);
        return res.status(500).json({
          success: false,
          message: 'Failed to process refund. Please contact support.'
        });
      }
    }
    // Process refund for annual to monthly downgrade
    else if (newPlan === 'monthly' && activeSubscription.plan === 'annual') {
      // Check if eligible for refund
      if (!Payment.isEligibleForDowngradeRefund(activeSubscription)) {
        return res.status(400).json({
          success: false,
          message: 'Subscription is not eligible for downgrade refund. Must have at least 7 days remaining.'
        });
      }

      try {
        refundResult = await Payment.createDowngradeRefund(activeSubscription, newPlan, userId);
      } catch (refundError) {
        console.error('Refund processing error:', refundError);
        return res.status(500).json({
          success: false,
          message: 'Failed to process refund. Please contact support.'
        });
      }
    }

    // Update subscription based on new plan
    if (newPlan === 'monthly') {
      // Create new monthly subscription
      const monthlyPayment = new Payment({
        paymentId: `MONTHLY_${Date.now()}`,
        amount: 99, // Monthly plan price
        currency: 'USD',
        status: 'completed',
        plan: 'monthly',
        billingCycle: 'monthly',
        paymentMethod: activeSubscription.paymentMethod,
        organizationID: organizationID,
        userId: userId,
        subscriptionStartDate: new Date(),
        subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        autoRenew: true,
        savePaymentMethod: activeSubscription.savePaymentMethod,
        transactionId: `MONTHLY_${Date.now()}`,
        gatewayResponse: {
          downgradeFrom: activeSubscription.plan,
          originalPaymentId: activeSubscription.paymentId,
          refundAmount: refundResult?.refundAmount || 0
        },
        originalPaymentId: activeSubscription.paymentId
      });

      await monthlyPayment.save();
      
      // Activate monthly premium for organization
      await activateOrganizationPremium(organizationID, 'monthly');
    } else if (newPlan === 'free') {
      // Deactivate premium for all users in organization
      await deactivateOrganizationPremium(organizationID);
    }

    res.json({
      success: true,
      message: `Successfully downgraded to ${newPlan} plan`,
      data: {
        newPlan,
        refundAmount: refundResult?.refundAmount || 0,
        remainingDays: refundResult?.remainingDays || 0,
        refundPaymentId: refundResult?.refundPayment?.paymentId,
        originalPlan: activeSubscription.plan
      }
    });
  } catch (error) {
    console.error('Downgrade subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Calculate refund amount for downgrade (without processing)
const calculateDowngradeRefund = async (req, res) => {
  try {
    const { organizationID } = req.params;
    const { newPlan } = req.query;

    // Validate new plan
    if (!['monthly', 'free'].includes(newPlan)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid new plan. Must be "monthly" or "free"'
      });
    }

    // Find active subscription
    const activeSubscription = await Payment.getActiveSubscription(organizationID);
    
    if (!activeSubscription) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found'
      });
    }

    // Check eligibility based on downgrade type
    if (newPlan === 'free') {
      // For downgrade to free, any active plan is eligible
      if (activeSubscription.status !== 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Subscription is not eligible for refund. Must be an active completed subscription.'
        });
      }

      // Check if subscription is still active
      const now = new Date();
      if (now >= activeSubscription.subscriptionEndDate) {
        return res.status(400).json({
          success: false,
          message: 'Subscription has already expired.'
        });
      }

      // Check if there are at least 1 day remaining (minimum refund period)
      const remainingDays = Math.ceil((activeSubscription.subscriptionEndDate - now) / (1000 * 60 * 60 * 24));
      if (remainingDays < 1) {
        return res.status(400).json({
          success: false,
          message: 'Subscription is not eligible for refund. Must have at least 1 day remaining.'
        });
      }
    } else if (newPlan === 'monthly') {
      // For downgrade to monthly, only annual plans are eligible
      if (activeSubscription.plan !== 'annual') {
        return res.status(400).json({
          success: false,
          message: 'Downgrade refunds are only available for annual plans'
        });
      }

      // Check if eligible for refund
      if (!Payment.isEligibleForDowngradeRefund(activeSubscription)) {
        return res.status(400).json({
          success: false,
          message: 'Subscription is not eligible for downgrade refund. Must have at least 7 days remaining.'
        });
      }
    }

    // Calculate refund amount
    const now = new Date();
    const originalEndDate = new Date(activeSubscription.subscriptionEndDate);
    const totalDays = Math.ceil((originalEndDate - activeSubscription.subscriptionStartDate) / (1000 * 60 * 60 * 24));
    const remainingDays = Math.ceil((originalEndDate - now) / (1000 * 60 * 60 * 24));
    const refundAmount = Math.round((activeSubscription.amount / totalDays) * remainingDays);

    res.json({
      success: true,
      data: {
        refundAmount,
        remainingDays,
        totalDays,
        originalAmount: activeSubscription.amount,
        newPlan,
        originalPlan: activeSubscription.plan
      }
    });
  } catch (error) {
    console.error('Calculate refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Upgrade subscription
const upgradeSubscription = async (req, res) => {
  try {
    const { organizationID } = req.params;
    const { newPlan, userId } = req.body;

    // Validate new plan
    if (newPlan !== 'annual') {
      return res.status(400).json({
        success: false,
        message: 'Invalid new plan. Must be "annual"'
      });
    }

    // Find active subscription
    const activeSubscription = await Payment.getActiveSubscription(organizationID);
    
    if (!activeSubscription) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found'
      });
    }

    // Admin check
    const isAdmin = await isOrgAdmin(organizationID, userId);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Only the organization admin can upgrade the subscription.' });
    }

    // Create new annual subscription
    const annualPayment = new Payment({
      paymentId: `ANNUAL_${Date.now()}`,
      amount: 708, // Annual plan price
      currency: 'USD',
      status: 'completed',
      plan: 'annual',
      billingCycle: 'annual',
      paymentMethod: activeSubscription.paymentMethod,
      organizationID: organizationID,
      userId: userId,
      subscriptionStartDate: new Date(),
      subscriptionEndDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 365 days
      autoRenew: true,
      savePaymentMethod: activeSubscription.savePaymentMethod,
      transactionId: `ANNUAL_${Date.now()}`,
      gatewayResponse: {
        upgradeFrom: activeSubscription.plan,
        originalPaymentId: activeSubscription.paymentId
      },
      originalPaymentId: activeSubscription.paymentId
    });

    await annualPayment.save();
    
    // Activate annual premium for organization
    await activateOrganizationPremium(organizationID, 'annual');

    res.json({
      success: true,
      message: 'Successfully upgraded to annual plan',
      data: {
        newPlan
      }
    });
  } catch (error) {
    console.error('Upgrade subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Helper functions
const simulatePaymentProcessing = async (paymentData) => {
  // Simulate payment gateway processing
  // In real implementation, integrate with Stripe, PayPal, etc.
  
  return new Promise((resolve) => {
    setTimeout(() => {
      // Simulate 95% success rate
      const isSuccess = Math.random() > 0.05;
      
      if (isSuccess) {
        resolve({
          success: true,
          transactionId: `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
          response: {
            status: 'succeeded',
            message: 'Payment processed successfully'
          }
        });
      } else {
        resolve({
          success: false,
          message: 'Payment declined by bank',
          response: {
            status: 'failed',
            message: 'Payment declined by bank'
          }
        });
      }
    }, 2000); // Simulate 2-second processing time
  });
};

const getCardBrand = (cardNumber) => {
  const cleanNumber = cardNumber.replace(/\s/g, '');
  
  if (/^4/.test(cleanNumber)) return 'visa';
  if (/^5[1-5]/.test(cleanNumber)) return 'mastercard';
  if (/^3[47]/.test(cleanNumber)) return 'amex';
  if (/^6/.test(cleanNumber)) return 'discover';
  
  return 'unknown';
};

const activateOrganizationPremium = async (organizationID, plan) => {
  try {
    // Get the organization
    const org = await Organization.findOne({ OrganizationID: organizationID });
    if (!org) throw new Error('Organization not found');
    // Get all users in the organization
    const users = await User.find({ organizationID: organizationID });
    // Calculate subscription dates
    const startDate = new Date();
    const endDate = new Date(startDate);
    if (plan === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (plan === 'annual') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }
    // Activate premium for all users
    const updatePromises = users.map(user => user.activatePremium(plan, startDate, endDate));
    await Promise.all(updatePromises);
    // Mark organization as premium
    org.isPremium = true;
    org.subscription = { plan, startDate, endDate };
    await org.save();
  } catch (error) {
    console.error('Error activating organization premium:', error);
    throw error;
  }
};

const deactivateOrganizationPremium = async (organizationID) => {
  try {
    // Get the organization
    const org = await Organization.findOne({ OrganizationID: organizationID });
    if (!org) throw new Error('Organization not found');
    // Get all users in the organization
    const users = await User.find({ organizationID: organizationID });
    // Deactivate premium for all users
    const updatePromises = users.map(user => user.deactivatePremium());
    await Promise.all(updatePromises);
    // Mark organization as not premium
    org.isPremium = false;
    org.subscription = { plan: 'free', startDate: null, endDate: null };
    await org.save();
  } catch (error) {
    console.error('Error deactivating organization premium:', error);
    throw error;
  }
};

const saveUserPaymentMethod = async (userId, paymentMethod, details) => {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    user.savedPaymentMethod = {
      type: paymentMethod,
      ...(paymentMethod === 'card' ? { cardDetails: details } : { bankDetails: details })
    };

    await user.save();
  } catch (error) {
    console.error('Error saving payment method:', error);
  }
};

// Get all payment data for organization (subscription status + payment history + subscription features)
const getOrganizationPaymentData = async (req, res) => {
  try {
    const { organizationID } = req.params;
    const { limit = 10, page = 1 } = req.query;

    const skip = (page - 1) * limit;
    
    // Get subscription status
    const activeSubscription = await Payment.getActiveSubscription(organizationID);
    const premiumUsers = await User.getPremiumUsers(organizationID);

    // Get payment history
    const payments = await Payment.getPaymentHistory(organizationID, parseInt(limit));
    const total = await Payment.countDocuments({ organizationID });

    // Get subscription features
    const allFeatures = await CommonType.find({ MasterType: 'SubscriptionFeatures' }).sort({ Code: 1 });
    
    // Group features by plan type
    const subscriptionFeatures = {
      free: allFeatures.filter(feature => feature.Description === 'free'),
      monthly: allFeatures.filter(feature => feature.Description === 'monthly'),
      annual: allFeatures.filter(feature => feature.Description === 'annual')
    };

    res.json({
      success: true,
      data: {
        subscription: {
          hasActiveSubscription: !!activeSubscription,
          subscription: activeSubscription,
          premiumUsersCount: premiumUsers.length,
          premiumUsers: premiumUsers.map(user => ({
            id: user._id,
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            subscriptionEndDate: user.subscriptionEndDate
          }))
        },
        paymentHistory: {
          payments,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            hasNext: skip + payments.length < total,
            hasPrev: page > 1
          }
        },
        subscriptionFeatures
      }
    });
  } catch (error) {
    console.error('Get organization payment data error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  processPayment,
  getPaymentHistory,
  getSubscriptionStatus,
  cancelSubscription,
  downgradeSubscription,
  calculateDowngradeRefund,
  upgradeSubscription,
  getOrganizationPaymentData
}; 