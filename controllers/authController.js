// Note: real-time emissions are handled in specific controllers/routes
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const UserActivity = require('../models/UserActivity');
const Organization = require('../models/Organization');
const axios = require('axios');
const qrcode = require('qrcode');
const speakeasy = require('speakeasy');
const nodemailer = require('nodemailer');
const { logActivity } = require('../services/activityService');
const { sendResetEmail } = require('../services/emailService');
const Invite = require('../models/Invite');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { emitToOrg } = require('../socket');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const {
      username,
      firstName,
      lastName,
      middleName,
      phone,
      phoneExtension,
      email,
      password,
      address,
      aptNumber,
      zipCode,
      city,
      state,
      country,
      inviteToken
    } = req.body;

    // Check if user already exists
    const userExists = await User.findOne({ $or: [{ email }, { username }, { phone }] });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    let organizationID = null;
    let invite = null;

    // Handle invite token if provided
    if (inviteToken) {
      invite = await Invite.findOne({
        token: inviteToken,
        status: 'Pending',
        email: email
      });

      if (!invite) {
        return res.status(400).json({ message: 'Invalid or expired invite token' });
      }

      // Set organization from invite
      organizationID = invite.organizationID;

      // Mark invite as accepted
      invite.status = 'Accepted';
      invite.acceptedAt = new Date();
      await invite.save();
    }

    // Create user
    const user = await User.create({
      username,
      firstName,
      lastName,
      middleName,
      phone,
      phoneExtension: phoneExtension || '+1', // Use provided extension or default
      email,
      password,
      address,
      aptNumber,
      zipCode,
      city,
      state,
      country,
      role: 'User',
      organizationID: organizationID,
      lastLogin: new Date(),
    });

    if (user) {
      // Log the user creation and last login
      res.status(201).json({
        _id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        phoneExtension: user.phoneExtension,
        organizationID: user.organizationID,
        role: user.role,
        token: generateToken(user._id),
        needsAdditionalDetails: !organizationID // Only need additional details if not invited
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;

    // Find user by username or email
    const user = await User.findOne({
      $or: [
        { email: usernameOrEmail },
        { username: usernameOrEmail }
      ]
    });

    // Check if user exists and password is correct
    if (user && (await user.comparePassword(password))) {
      // Update last login and set status to Active
      user.lastLogin = new Date();
      user.status = 'Active';
      await user.save();

      // Log successful login
      await logActivity(user._id, 'login', 'success', 'User logged in successfully', req, {}, 'email');

      if (user.twoFactorEnabled) {
        return res.status(200).json({
          twoFactorEnabled: true,
          userId: user._id
        });
      }

      return res.status(200).json({
        _id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        organizationID: user.organizationID,
        token: generateToken(user._id),
        // Include security settings in login response
        twoFactorEnabled: user.twoFactorEnabled || false,
        sessionTimeout: user.sessionTimeout || 30,
        loginNotifications: user.loginNotifications !== false, // default to true if not set
        status: user.status,
      });
    } else {
      // Log failed login attempt
      if (user) {
        await logActivity(user._id, 'login_failed', 'error', 'Invalid password', req, {}, 'email');
      } else {
        // Log failed login attempt for non-existent user
        await logActivity(null, 'login_failed', 'error', 'User not found', req, {}, 'email');
      }
      res.status(401).json({ message: 'Invalid username/email or password' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logoutUser = async (req, res) => {
  try {
    // Log the logout activity
    await logActivity(req.user._id, 'logout', 'success', 'User logged out successfully', req);

    // Update user status to Offline
    await User.findByIdAndUpdate(req.user._id, { status: 'Offline' });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Error during logout' });
  }
};

// @desc    Google Sign In
// @route   POST /api/auth/google
// @access  Public
const googleLogin = async (req, res) => {
  try {

    const { credential, inviteToken } = req.body;

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { email_verified, name, email, given_name, family_name, sub, picture } = ticket.getPayload();

    // If email is not verified by Google
    if (!email_verified) {
      await logActivity(null, 'login_failed', 'error', 'Email not verified by Google', req, 'google');
      return res.status(400).json({ message: 'Email not verified by Google' });
    }

    // Check if user exists
    let user = await User.findOne({ email });

    if (user) {
      // If user exists, update last login
      user.lastLogin = new Date();
      user.status = 'Active';
      await user.save();

      // Log successful Google login
      await logActivity(user._id, 'login', 'success', 'User logged in via Google', req, { provider: 'google' });

      // Return user data with token and Google profile image
      return res.json({
        _id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        organizationID: user.organizationID,
        profileImage: picture,
        token: generateToken(user._id),
        role: user.role,
        needsAdditionalDetails: false,
        // Include security settings in login response
        twoFactorEnabled: user.twoFactorEnabled || false,
        sessionTimeout: user.sessionTimeout || 30,
        loginNotifications: user.loginNotifications !== false, // default to true if not set
        status: user.status
      });
    } else {
      // If user doesn't exist, create new user with partial profile
      // Generate username from email
      const username = email.split('@')[0] + Math.floor(Math.random() * 1000);

      // Create random password for Google users
      const password = Math.random().toString(36).slice(-8);

      let organizationID = null;
      let invite = null;

      // Handle invite token if provided
      if (inviteToken) {
        invite = await Invite.findOne({
          token: inviteToken,
          status: 'Pending',
          email: email
        });

        if (!invite) {
          return res.status(400).json({ message: 'Invalid or expired invite token' });
        }

        // Set organization from invite
        organizationID = invite.organizationID;

        // Mark invite as accepted
        invite.status = 'Accepted';
        invite.acceptedAt = new Date();
        await invite.save();
      }

      user = await User.create({
        username,
        firstName: given_name || name.split(' ')[0],
        lastName: family_name || name.split(' ').slice(1).join(' '),
        email,
        password,
        googleId: sub,
        lastLogin: new Date(),
        // Set these fields as null to indicate they need to be filled
        phone: null,
        middleName: null,
        address: null,
        aptNumber: null,
        zipCode: null,
        city: null,
        state: null,
        country: null,
        role: 'User',
        organizationID: organizationID,
        // Set default security settings
        twoFactorEnabled: false,
        sessionTimeout: 30,
        loginNotifications: true,
        status: 'Offline'
      });

      // Log successful Google login for new user
      await logActivity(user._id, 'login', 'success', 'New user registered and logged in via Google', req, { provider: 'google' });

      res.status(201).json({
        _id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profileImage: picture,
        token: generateToken(user._id),
        needsAdditionalDetails: !organizationID, // Only need additional details if not invited
        role: user.role,
        message: organizationID ? 'Welcome to the organization!' : 'Please complete your profile with additional details',
        // Include security settings in login response
        twoFactorEnabled: false,
        sessionTimeout: 30,
        loginNotifications: true,
        status: 'Offline'
      });
    }
  } catch (error) {
    console.error(error);
    // Log failed Google login attempt
    await logActivity(null, 'login_failed', 'error', 'Google login failed: ' + error.message, req, { provider: 'google' });
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update user profile with additional details
// @route   PUT /api/auth/complete-profile
// @access  Private
const completeUserProfile = async (req, res) => {
  try {
    const {
      phone,
      phoneExtension,
      middleName,
      address,
      aptNumber,
      zipCode,
      city,
      state,
      country,
      organizationID,
      role,
      needsUpdate
    } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (needsUpdate === 'organizationID') {
      user.organizationID = organizationID;
    }
    else {
      // Update user profile with additional details
      user.phone = phone;
      user.phoneExtension = phoneExtension || user.phoneExtension; // Keep existing if not provided
      user.middleName = middleName;
      user.address = address;
      user.aptNumber = aptNumber;
      user.zipCode = zipCode;
      user.city = city;
      user.state = state;
      user.country = country;
    }

    if (role) {
      // Verify that the role exists in CommonTypes
      const CommonType = require('../models/CommonType');
      const roleExists = await CommonType.findOne({
        MasterType: 'UserRole',
        Value: role
      });
      if (!roleExists) {
        return res.status(400).json({ message: 'Invalid role' });
      }
      user.role = role;
    }

    // Mark user as Active after profile completion
    user.status = 'Active';

    await user.save();

    // Log profile update
    await logActivity(user._id, 'profile_update', 'success', 'Profile updated successfully', req);

    // Only try to find organization if organizationID is provided
    let organization = null;
    if (user.organizationID) {
      organization = await Organization.findOne({
        OrganizationID: user.organizationID
      });
    }

    res.json({
      _id: user._id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      phoneExtension: user.phoneExtension,
      middleName: user.middleName,
      address: user.address,
      aptNumber: user.aptNumber,
      zipCode: user.zipCode,
      city: user.city,
      state: user.state,
      country: user.country,
      organizationID: user.organizationID,
      needsAdditionalDetails: false,
      role: user.role,
      organization: organization ? {
        name: organization.Name,
        code: organization.Code
      } : null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -googleId');

    if (user) {
      // If user has an organization ID, fetch the organization details
      if (user.organizationID) {
        const CommonType = require('../models/CommonType');

        const organization = await Organization.findOne({
          OrganizationID: user.organizationID
        });

        // Add organization details to the response
        const userProfile = user.toObject();
        userProfile.organization = organization ? {
          name: organization.Name,
          code: organization.Code
        } : null;
        userProfile.organizationID = user.organizationID;
        userProfile.status = user.status;
        userProfile.orgName = organization ? organization.Name : null;
        res.json(userProfile);
      } else {
        res.json(user);
      }
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get user activities
// @route   GET /api/auth/activities
// @access  Private
const getUserActivities = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;


    let types = ['team_create', 'team_update', 'team_delete', 'team_join', 'team_leave', 'team_status_toggle', 'project_create', 'project_update', 'task_create', 'task_update', 'task_complete', 'task_assign', 'user_story_create', 'user_story_update', 'user_story_delete'];

    const result = await UserActivity.find({ user: req.user._id, type: { $in: types } })
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await UserActivity.countDocuments({ user: req.user._id });

    res.json({
      activities: result,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get user organizations
// @route   GET /api/auth/organizations
// @access  Private
const getUserOrganizations = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('organizationID');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // If user has an organization ID, fetch the organization details
    if (user.organizationID) {
      const organization = await Organization.findOne({
        OrganizationID: user.organizationID
      });

      if (organization) {
        return res.json([{
          _id: organization._id,
          name: organization.Name,
          code: organization.Code
        }]);
      }
    }

    res.json([]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Generate 2FA
// @route   POST /api/auth/2fa/generate
// @access  Private
const generate2FA = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);

    // Generate new secret
    const secret = speakeasy.generateSecret({
      name: `TeamLabs:${user.email}`,
      issuer: 'TeamLabs'
    });

    // Generate QR code
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    // Store temporary secret in database
    user.tempTwoFactorSecret = secret.base32;
    user.tempTwoFactorSecretCreatedAt = new Date();
    await user.save();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      secret: secret.base32,
      qrCode,
      otpauth_url: secret.otpauth_url
    });
  } catch (error) {
    console.error('2FA Generation Error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// @desc    Verify 2FA
// @route   POST /api/auth/2fa/verify
// @access  Private
const verify2FA = async (req, res) => {
  try {
    const { token } = req.body;
    const user = await User.findById(req.user.id).select('+tempTwoFactorSecret');

    if (!user || !user.tempTwoFactorSecret) {
      return res.status(400).json({ error: 'No temporary secret found. Please generate a new one.' });
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.tempTwoFactorSecret,
      encoding: 'base32',
      token: token
    });

    if (!verified) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Move temporary secret to permanent secret and enable 2FA
    await User.findByIdAndUpdate(req.user.id, {
      twoFactorSecret: user.tempTwoFactorSecret,
      twoFactorEnabled: true,
      $unset: { tempTwoFactorSecret: 1, tempTwoFactorSecretCreatedAt: 1 }
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('2FA Verification Error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// @desc    Disable 2FA
// @route   POST /api/auth/2fa/disable
// @access  Private
const disable2FA = async (req, res) => {
  try {
    const { token } = req.body;
    const user = await User.findById(req.user.id).select('+twoFactorSecret');

    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    // Verify the token before disabling
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token
    });

    if (!verified) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Disable 2FA
    await User.findByIdAndUpdate(req.user.id, {
      twoFactorEnabled: false,
      $unset: { twoFactorSecret: 1 }
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('2FA Disable Error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// @desc    Verify Login 2FA
// @route   POST /api/auth/2fa/verify-login
// @access  Private
const verifyLogin2FA = async (req, res) => {
  try {
    const { code, userId } = req.body;
    const user = await User.findById(userId).select('+twoFactorSecret');

    if (!user || !user.twoFactorSecret || !user.twoFactorEnabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code
    });

    if (!verified) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    return res.status(200).json({
      _id: user._id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      organizationID: user.organizationID,
      token: generateToken(user._id),
      // Include security settings in login response
      twoFactorEnabled: user.twoFactorEnabled || false,
      sessionTimeout: user.sessionTimeout || 30,
      loginNotifications: user.loginNotifications !== false, // default to true if not set
      status: user.status
    });
  } catch (error) {
    console.error('2FA Login Verification Error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// @desc    Get Security Settings
// @route   GET /api/auth/security-settings
// @access  Private
const getSecuritySettings = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('twoFactorEnabled sessionTimeout loginNotifications');

    return res.json({
      twoFactorEnabled: user?.twoFactorEnabled || false,
      sessionTimeout: user?.sessionTimeout || 30,
      loginNotifications: user?.loginNotifications || true
    });
  } catch (error) {
    console.error('Security Settings Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Update Security Settings
// @route   PUT /api/auth/security-settings
// @access  Private
const updateSecuritySettings = async (req, res) => {
  try {
    const { sessionTimeout, loginNotifications, userId } = req.body;

    await User.findByIdAndUpdate(userId, {
      $set: {
        sessionTimeout: Number(sessionTimeout),
        loginNotifications: Boolean(loginNotifications)
      }
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Security Settings Update Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Update User Status
// @route   PUT /api/auth/status
// @access  Private
const updateUserStatus = async (req, res) => {
  try {

    const { status, userId } = req.body;

    // Validate status
    const validStatuses = ['Active', 'In a Meeting', 'Presenting', 'Away', 'Offline', 'Busy'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { status },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Emit real-time update to organization members
    try {
      if (user.organizationID) {
        emitToOrg(user.organizationID, 'org.member.updated', {
          event: 'org.member.updated',
          version: 1,
          data: {
            organizationId: String(user.organizationID),
            member: {
              userId: user._id.toString(),
              name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
              role: user.role,
              status: user.status
            }
          },
          meta: { emittedAt: new Date().toISOString() }
        });
      }
    } catch (e) { /* ignore emission errors */ }

    res.status(200).json({ message: 'Status updated successfully', status: user.status });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ message: 'Error updating status' });
  }
};

// @desc    Request password reset
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const { usernameOrEmail } = req.body;
    if (!usernameOrEmail) {
      return res.status(400).json({ message: 'Username or email is required' });
    }
    const user = await User.findOne({
      $or: [
        { email: usernameOrEmail },
        { username: usernameOrEmail }
      ]
    });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    // Generate unique key and expiry
    const key = uuidv4();
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const link = `${process.env.FRONTEND_URL}/reset-password?key=${key}`;
    // Create ForgotPasswordHistory record
    await ForgotPasswordHistory.create({
      Username: user.username,
      AttemptNo: 1,
      MaxNoOfAttempts: 3,
      Key: key,
      ExpiryTime: expiry,
      Link: link,
      IsValid: true
    });
    // Send email with link
    await sendResetEmail(user.email, user.username, link);
    res.json({ message: 'If the user exists, a password reset link has been sent to the registered email.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Reset password
// @route   POST /api/auth/verify-reset-password
// @access  Public
const verifyResetPassword = async (req, res) => {
  try {
    const { key } = req.body;
    const record = await ForgotPasswordHistory.findOne({ Key: key });
    if (!record) {
      return res.status(201).json({ message: 'Invalid or expired reset link' });
    }
    if (record.IsValid == false) {
      return res.status(201).json({ message: 'Reset link has already been used' });
    }
    if (record.ExpiryTime < new Date()) {
      return res.status(201).json({ message: 'Reset link has expired' });
    }
    return res.status(200).json({ message: 'Reset link is valid' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const { key, newPassword } = req.body;
    if (!key || !newPassword) {
      return res.status(400).json({ message: 'Key and new password are required' });
    }
    const record = await ForgotPasswordHistory.findOne({ Key: key, IsValid: true });
    if (!record) {
      return res.status(400).json({ message: 'Invalid or expired reset link' });
    }
    if (record.ExpiryTime < new Date()) {
      return res.status(400).json({ message: 'Reset link has expired' });
    }
    const user = await User.findOne({ username: record.Username });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    // Check if new password is same as old password
    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      return res.status(400).json({ message: 'New password cannot be the same as the old password' });
    }
    // Enforce strong password requirements
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!strongPasswordRegex.test(newPassword)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters, include uppercase, lowercase, number, and special character.' });
    }
    // Update password
    user.password = newPassword;
    await user.save();
    // Mark record as used
    record.IsValid = false;
    record.PasswordChangedDate = new Date();
    await record.save();
    res.status(200).json({ message: 'Password has been reset successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// GitHub OAuth Integration
const initiateGitHubAuth = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    // Generate state parameter for security using browser-compatible method
    const generateRandomString = (length) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const state = generateRandomString(32);

    // Store state in session or temporary storage (for production, use Redis)
    // For now, we'll use a simple approach
    const redirectUri = `${process.env.CLIENT_URL || 'http://localhost:3000'}/github-callback`;
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=repo,user:email&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    res.json({
      success: true,
      authUrl: githubAuthUrl,
      state: state
    });
  } catch (error) {
    console.error('GitHub auth initiation error:', error);
    res.status(500).json({ success: false, error: 'Failed to initiate GitHub authentication' });
  }
};

const handleGitHubCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    const { userId } = req.body;

    if (!code || !state || !userId) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }

    // Exchange code for access token
    const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: code
    }, {
      headers: {
        'Accept': 'application/json'
      }
    });

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      return res.status(400).json({ success: false, error: 'Failed to obtain access token' });
    }

    // Get user information from GitHub
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${access_token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    const githubUser = userResponse.data;

    // Get user's email from GitHub
    const emailsResponse = await axios.get('https://api.github.com/user/emails', {
      headers: {
        'Authorization': `token ${access_token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    const primaryEmail = emailsResponse.data.find(email => email.primary)?.email || githubUser.email;

    // Update user with GitHub information
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        githubConnected: true,
        githubAccessToken: access_token,
        githubUserId: githubUser.id.toString(),
        githubUsername: githubUser.login,
        githubEmail: primaryEmail,
        githubAvatarUrl: githubUser.avatar_url,
        githubConnectedAt: new Date()
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Log the activity
    await UserActivity.create({
      userId: userId,
      type: 'github_connected',
      details: `Connected GitHub account: ${githubUser.login}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'GitHub account connected successfully',
      githubUser: {
        username: githubUser.login,
        email: primaryEmail,
        avatarUrl: githubUser.avatar_url
      }
    });
  } catch (error) {
    console.error('GitHub callback error:', error);
    res.status(500).json({ success: false, error: 'Failed to complete GitHub authentication' });
  }
};

const disconnectGitHub = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (!user.githubConnected) {
      return res.status(400).json({ success: false, error: 'GitHub account is not connected' });
    }

    // Revoke GitHub access token
    if (user.githubAccessToken) {
      try {
        await axios.delete(`https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/token`, {
          headers: {
            'Authorization': `token ${user.githubAccessToken}`,
            'Accept': 'application/vnd.github.v3+json'
          },
          data: {
            access_token: user.githubAccessToken
          }
        });
      } catch (error) {
        console.error('Error revoking GitHub token:', error);
        // Continue with disconnection even if token revocation fails
      }
    }

    // Update user to remove GitHub connection
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        githubConnected: false,
        githubAccessToken: null,
        githubUserId: null,
        githubUsername: null,
        githubEmail: null,
        githubAvatarUrl: null,
        githubConnectedAt: null
      },
      { new: true }
    );

    // Log the activity
    await UserActivity.create({
      userId: userId,
      type: 'github_disconnected',
      details: 'Disconnected GitHub account',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'GitHub account disconnected successfully'
    });
  } catch (error) {
    console.error('GitHub disconnect error:', error);
    res.status(500).json({ success: false, error: 'Failed to disconnect GitHub account' });
  }
};

const getGitHubStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const user = await User.findById(userId).select('githubConnected githubUsername githubEmail githubAvatarUrl githubConnectedAt');

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      githubStatus: {
        connected: user.githubConnected,
        username: user.githubUsername,
        email: user.githubEmail,
        avatarUrl: user.githubAvatarUrl,
        connectedAt: user.githubConnectedAt
      }
    });
  } catch (error) {
    console.error('GitHub status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get GitHub status' });
  }
};

// GitHub Repository methods
const getUserRepositories = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (!user.githubConnected) {
      return res.status(400).json({ success: false, error: 'GitHub account not connected' });
    }

    // Fetch user's repositories from GitHub
    const response = await axios.get('https://api.github.com/user/repos', {
      headers: {
        'Authorization': `token ${user.githubAccessToken}`,
        'Accept': 'application/vnd.github.v3+json'
      },
      params: {
        sort: 'updated',
        per_page: 100
      }
    });

    const repositories = response.data.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      language: repo.language,
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      private: repo.private,
      updated_at: repo.updated_at
    }));

    res.json({
      success: true,
      repositories
    });
  } catch (error) {
    console.error('Error fetching user repositories:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch repositories' });
  }
};

// Project GitHub Repository methods
const linkRepositoryToProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { repositoryData } = req.body;
    const userId = req.user._id;

    if (!projectId || !repositoryData) {
      return res.status(400).json({ success: false, error: 'Project ID and repository data are required' });
    }

    // Check if user has GitHub connected
    const user = await User.findById(userId);
    if (!user || !user.githubConnected) {
      return res.status(400).json({ success: false, error: 'GitHub account not connected' });
    }

    // Import Project model
    const Project = require('../models/Project');

    // Find the project
    const project = await Project.findOne({ ProjectID: projectId });
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    // Check if user is project owner or has permission
    if (project.ProjectOwner.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized to link repository to this project' });
    }

    // Update project with repository information
    const updatedProject = await Project.findOneAndUpdate(
      { ProjectID: projectId },
      {
        'githubRepository.connected': true,
        'githubRepository.repositoryId': repositoryData.id,
        'githubRepository.repositoryName': repositoryData.name,
        'githubRepository.repositoryUrl': repositoryData.html_url,
        'githubRepository.repositoryFullName': repositoryData.full_name,
        'githubRepository.repositoryDescription': repositoryData.description,
        'githubRepository.repositoryLanguage': repositoryData.language,
        'githubRepository.repositoryStars': repositoryData.stargazers_count,
        'githubRepository.repositoryForks': repositoryData.forks_count,
        'githubRepository.connectedAt': new Date(),
        'githubRepository.connectedBy': userId
      },
      { new: true }
    );

    // Log the activity
    await UserActivity.create({
      user: userId,
      type: 'repository_linked',
      status: 'success',
      details: `Linked repository ${repositoryData.full_name} to project ${project.Name}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Repository linked successfully',
      project: updatedProject
    });
  } catch (error) {
    console.error('Error linking repository to project:', error);
    res.status(500).json({ success: false, error: 'Failed to link repository to project' });
  }
};

const unlinkRepositoryFromProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user._id;

    if (!projectId) {
      return res.status(400).json({ success: false, error: 'Project ID is required' });
    }

    // Import Project model
    const Project = require('../models/Project');

    // Find the project
    const project = await Project.findOne({ ProjectID: projectId });
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    // Check if user is project owner or has permission
    if (project.ProjectOwner.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized to unlink repository from this project' });
    }

    // Check if repository is linked
    if (!project.githubRepository?.connected) {
      return res.status(400).json({ success: false, error: 'No repository linked to this project' });
    }

    // Update project to remove repository information
    const updatedProject = await Project.findOneAndUpdate(
      { ProjectID: projectId },
      {
        'githubRepository.connected': false,
        'githubRepository.repositoryId': null,
        'githubRepository.repositoryName': null,
        'githubRepository.repositoryUrl': null,
        'githubRepository.repositoryFullName': null,
        'githubRepository.repositoryDescription': null,
        'githubRepository.repositoryLanguage': null,
        'githubRepository.repositoryStars': 0,
        'githubRepository.repositoryForks': 0,
        'githubRepository.connectedAt': null,
        'githubRepository.connectedBy': null
      },
      { new: true }
    );

    // Log the activity
    await UserActivity.create({
      user: userId,
      type: 'repository_unlinked',
      status: 'success',
      details: `Unlinked repository from project ${project.Name}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Repository unlinked successfully',
      project: updatedProject
    });
  } catch (error) {
    console.error('Error unlinking repository from project:', error);
    res.status(500).json({ success: false, error: 'Failed to unlink repository from project' });
  }
};

const updateOnboardingStatus = async (req, res) => {
  try {
    const { completed, step, progress } = req.body;
    const userId = req.user._id;

    const updateData = {};
    if (completed !== undefined) updateData.onboardingCompleted = completed;
    if (step) updateData.onboardingStep = step;
    if (progress) updateData.onboardingProgress = progress;

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      success: true,
      onboardingCompleted: user.onboardingCompleted,
      onboardingStep: user.onboardingStep,
      onboardingProgress: user.onboardingProgress
    });
  } catch (error) {
    console.error('Error updating onboarding status:', error);
    res.status(500).json({ message: 'Failed to update onboarding status' });
  }
};

const getProjectRepository = async (req, res) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({ success: false, error: 'Project ID is required' });
    }

    // Import Project model
    const Project = require('../models/Project');

    // Find the project
    const project = await Project.findOne({ ProjectID: projectId });
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    if (!project.githubRepository?.connected) {
      return res.json({
        success: true,
        repository: null
      });
    }

    res.json({
      success: true,
      repository: project.githubRepository
    });
  } catch (error) {
    console.error('Error getting project repository:', error);
    res.status(500).json({ success: false, error: 'Failed to get project repository' });
  }
};

// Get commits from GitHub repository
const getProjectCommits = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { page = 1, per_page = 20 } = req.query;
    const userId = req.user._id;

    if (!projectId) {
      return res.status(400).json({ success: false, error: 'Project ID is required' });
    }

    // Import Project model
    const Project = require('../models/Project');

    // Find the project
    const project = await Project.findOne({ ProjectID: projectId });
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    // Check if repository is linked
    if (!project.githubRepository?.connected) {
      return res.status(400).json({ success: false, error: 'No repository linked to this project' });
    }

    // Get the user who linked the repository
    const linkingUser = await User.findById(project.githubRepository.connectedBy);
    if (!linkingUser || !linkingUser.githubConnected) {
      return res.status(400).json({ success: false, error: 'Repository owner not connected to GitHub' });
    }

    // Fetch commits from GitHub API
    const response = await axios.get(
      `https://api.github.com/repos/${project.githubRepository.repositoryFullName}/commits`,
      {
        headers: {
          'Authorization': `token ${linkingUser.githubAccessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        params: {
          page,
          per_page
        }
      }
    );

    // Format the commits data
    const commits = response.data.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
        date: commit.commit.author.date
      },
      committer: {
        name: commit.commit.committer.name,
        email: commit.commit.committer.email,
        date: commit.commit.committer.date
      },
      html_url: commit.html_url,
      url: commit.url,
      parents: commit.parents.map(parent => parent.sha)
    }));

    res.json({
      success: true,
      commits,
      pagination: {
        page: parseInt(page),
        per_page: parseInt(per_page),
        has_next: response.data.length === parseInt(per_page)
      }
    });
  } catch (error) {
    console.error('Error fetching project commits:', error);
    if (error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'Repository not found or access denied' });
    }
    res.status(500).json({ success: false, error: 'Failed to fetch commits' });
  }
};

// Get issues from GitHub repository
const getProjectIssues = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { page = 1, per_page = 20 } = req.query;
    const userId = req.user._id;

    if (!projectId) {
      return res.status(400).json({ success: false, error: 'Project ID is required' });
    }

    // Import Project model
    const Project = require('../models/Project');

    // Find the project
    const project = await Project.findOne({ ProjectID: projectId });
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    // Check if repository is linked
    if (!project.githubRepository?.connected) {
      return res.status(400).json({ success: false, error: 'No repository linked to this project' });
    }

    // Get the user who linked the repository
    const linkingUser = await User.findById(project.githubRepository.connectedBy);
    if (!linkingUser || !linkingUser.githubConnected) {
      return res.status(400).json({ success: false, error: 'Repository owner not connected to GitHub' });
    }

    // Fetch issues from GitHub API
    const response = await axios.get(
      `https://api.github.com/repos/${project.githubRepository.repositoryFullName}/issues`,
      {
        headers: {
          'Authorization': `token ${linkingUser.githubAccessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        params: {
          page,
          per_page,
          state: 'all' // Get both open and closed issues
        }
      }
    );

    // Format the issues data
    const issues = response.data.map(issue => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      locked: issue.locked,
      assignees: issue.assignees,
      labels: issue.labels,
      user: {
        login: issue.user.login,
        avatar_url: issue.user.avatar_url,
        html_url: issue.user.html_url
      },
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      closed_at: issue.closed_at,
      html_url: issue.html_url,
      comments: issue.comments,
      pull_request: issue.pull_request
    }));

    res.json({
      success: true,
      issues,
      pagination: {
        page: parseInt(page),
        per_page: parseInt(per_page),
        has_next: response.data.length === parseInt(per_page)
      }
    });
  } catch (error) {
    console.error('Error fetching project issues:', error);
    if (error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'Repository not found or access denied' });
    }
    res.status(500).json({ success: false, error: 'Failed to fetch issues' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  googleLogin,
  getUserProfile,
  completeUserProfile,
  getUserActivities,
  logoutUser,
  getUserOrganizations,
  generate2FA,
  verify2FA,
  disable2FA,
  verifyLogin2FA,
  getSecuritySettings,
  updateSecuritySettings,
  updateUserStatus,
  forgotPassword,
  resetPassword,
  verifyResetPassword,
  initiateGitHubAuth,
  handleGitHubCallback,
  disconnectGitHub,
  getGitHubStatus,
  getUserRepositories,
  linkRepositoryToProject,
  unlinkRepositoryFromProject,
  getProjectRepository,
  getProjectCommits,
  getProjectIssues,
  updateOnboardingStatus
}; 