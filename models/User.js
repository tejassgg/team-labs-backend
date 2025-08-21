const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - username
 *         - firstName
 *         - lastName
 *         - email
 *         - password
 *       properties:
 *         username:
 *           type: string
 *           description: Unique username for the user
 *         firstName:
 *           type: string
 *           description: User's first name
 *         lastName:
 *           type: string
 *           description: User's last name
 *         middleName:
 *           type: string
 *           description: User's middle name (optional)
 *         phone:
 *           type: string
 *           description: User's phone number
 *         phoneExtension:
 *           type: string
 *           description: User's phone extension
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *         password:
 *           type: string
 *           format: password
 *           description: User's password (hashed)
 *         address:
 *           type: string
 *           description: User's street address
 *         aptNumber:
 *           type: string
 *           description: Apartment or suite number
 *         zipCode:
 *           type: string
 *           description: ZIP or postal code
 *         city:
 *           type: string
 *           description: City name
 *         state:
 *           type: string
 *           description: State or province
 *         country:
 *           type: string
 *           description: Country name
 *         lastLogin:
 *           type: string
 *           format: date-time
 *           description: Last login timestamp
 *         isActive:
 *           type: boolean
 *           description: Whether the user account is active
 *         googleId:
 *           type: string
 *           description: Google OAuth ID if user signed up with Google
 *         profileImage:
 *           type: string
 *           description: URL to user's profile image
 *         createdDate:
 *           type: string
 *           format: date-time
 *           description: Account creation timestamp
 *         organizationID:
 *           type: string
 *           description: Organization ID from CommonTypes collection
 */

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  middleName: {
    type: String,
    default: '',
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  phoneExtension: {
    type: String,
    trim: true,
    default: '+1' // Default to US/Canada
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  address: {
    type: String,
    default: '',
    trim: true
  },
  aptNumber: {
    type: String,
    default: '',
    trim: true
  },
  zipCode: {
    type: String,
    default: '',
    trim: true
  },
  city: {
    type: String,
    default: '',
    trim: true
  },
  state: {
    type: String,
    default: '',
    trim: true
  },
  country: {
    type: String,
    default: '',
    trim: true
  },
  lastLogin: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  googleId: {
    type: String,
    default: null
  },
  profileImage: {
    type: String,
    default: ''
  },
  createdDate: {
    type: Date,
    default: Date.now
  },
  organizationID: {
    type: String,
    default: ''
  },
  role: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['Active', 'In a Meeting', 'Presenting', 'Away', 'Offline', 'Busy'],
    default: 'Offline'
  },
  socketId: {
    type: String,
    default: null
  },
  twoFactorSecret: {
    type: String,
    select: false // Don't include in queries by default
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  tempTwoFactorSecret: {
    type: String,
    select: false
  },
  tempTwoFactorSecretCreatedAt: {
    type: Date
  },
  
  // Subscription Properties
  subscriptionStatus: {
    type: String,
    enum: ['free', 'premium'],
    default: 'free'
  },
  
  // Onboarding Properties
  onboardingCompleted: {
    type: Boolean,
    default: false
  },
  onboardingStep: {
    type: String,
    enum: ['welcome', 'profile', 'organization', 'team', 'project', 'complete'],
    default: 'welcome'
  },
  onboardingProgress: {
    profileComplete: { type: Boolean, default: false },
    organizationComplete: { type: Boolean, default: false },
    teamCreated: { type: Boolean, default: false },
    projectCreated: { type: Boolean, default: false },
    onboardingComplete: { type: Boolean, default: false }
  },
  subscriptionPlan: {
    type: String,
    enum: [null,'monthly', 'annual'],
    default: null
  },
  subscriptionStartDate: {
    type: Date,
    default: null
  },
  subscriptionEndDate: {
    type: Date,
    default: null
  },
  isPremiumMember: {
    type: Boolean,
    default: false
  },
  
  // Payment Method (encrypted)
  savedPaymentMethod: {
    type: {
      type: String,
      enum: [null, 'card', 'bank'],
      default: null
    },
    cardDetails: {
      last4: String,
      brand: String,
      expiryMonth: String,
      expiryYear: String,
      cardHolderName: String
    },
    bankDetails: {
      bankName: String,
      accountLast4: String,
      routingNumber: String,
      accountHolderName: String
    }
  },
  
  // Usage Limits (for free plan)
  usageLimits: {
    projectsCreated: {
      type: Number,
      default: 0
    },
    userStoriesCreated: {
      type: Number,
      default: 0
    },
    tasksCreated: {
      type: Number,
      default: 0
    }
  },

  // GitHub Integration fields
  githubConnected: {
    type: Boolean,
    default: false
  },
  githubAccessToken: {
    type: String,
    default: null
  },
  githubUserId: {
    type: String,
    default: null
  },
  githubUsername: {
    type: String,
    default: null
  },
  githubEmail: {
    type: String,
    default: null
  },
  githubAvatarUrl: {
    type: String,
    default: null
  },
  githubConnectedAt: {
    type: Date,
    default: null
  }
});

// Before saving, hash password
UserSchema.pre('save', async function(next) {
  // Only hash the password if it's new or modified
  if (!this.isModified('password')) return next();
  
  try {
    // Generate salt
    const salt = await bcrypt.genSalt(10);
    // Hash the password
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to check if 2FA is enabled
UserSchema.methods.isTwoFactorEnabled = function() {
  return this.twoFactorEnabled;
};

// Method to get 2FA secret (only when explicitly selected)
UserSchema.methods.getTwoFactorSecret = async function() {
  if (!this.twoFactorSecret) return null;
  return this.twoFactorSecret;
};

// Subscription Methods
UserSchema.methods.isSubscriptionActive = function() {
  if (!this.isPremiumMember) return false;
  if (!this.subscriptionEndDate) return false;
  return new Date() <= this.subscriptionEndDate;
};

UserSchema.methods.getDaysUntilExpiry = function() {
  if (!this.subscriptionEndDate) return 0;
  const now = new Date();
  const end = new Date(this.subscriptionEndDate);
  const diffTime = end - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};

UserSchema.methods.canCreateProject = function() {
  if (this.isPremiumMember && this.isSubscriptionActive()) {
    return true; // Unlimited for premium
  }
  return this.usageLimits.projectsCreated < 3; // Free plan limit
};

UserSchema.methods.canCreateUserStory = function() {
  if (this.isPremiumMember && this.isSubscriptionActive()) {
    return true; // Unlimited for premium
  }
  return this.usageLimits.userStoriesCreated < 3; // Free plan limit
};

UserSchema.methods.canCreateTask = function() {
  if (this.isPremiumMember && this.isSubscriptionActive()) {
    return true; // Unlimited for premium
  }
  return this.usageLimits.tasksCreated < 20; // Free plan limit per user story
};

UserSchema.methods.incrementUsage = function(type) {
  if (type === 'project') {
    this.usageLimits.projectsCreated += 1;
  } else if (type === 'userStory') {
    this.usageLimits.userStoriesCreated += 1;
  } else if (type === 'task') {
    this.usageLimits.tasksCreated += 1;
  }
  return this.save();
};

UserSchema.methods.activatePremium = function(plan, startDate, endDate) {
  this.isPremiumMember = true;
  this.subscriptionStatus = 'premium';
  this.subscriptionPlan = plan;
  this.subscriptionStartDate = startDate;
  this.subscriptionEndDate = endDate;
  return this.save();
};

UserSchema.methods.deactivatePremium = function() {
  this.isPremiumMember = false;
  this.subscriptionStatus = 'free';
  this.subscriptionPlan = null;
  this.subscriptionStartDate = null;
  this.subscriptionEndDate = null;
  return this.save();
};

// Static method to get all premium users in an organization
UserSchema.statics.getPremiumUsers = function(organizationId) {
  return this.find({
    organizationID: organizationId,
    isPremiumMember: true,
    subscriptionEndDate: { $gte: new Date() }
  });
};

// Static method to check if organization has active premium subscription
UserSchema.statics.hasActivePremiumSubscription = function(organizationId) {
  return this.findOne({
    organizationID: organizationId,
    isPremiumMember: true,
    subscriptionEndDate: { $gte: new Date() }
  });
};

const User = mongoose.model('User', UserSchema);

module.exports = User; 