const express = require('express');
const router = express.Router();
const {
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
  updateOnboardingStatus,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const User = require('../models/User');

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - firstName
 *               - lastName
 *               - email
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               middleName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: User already exists
 */
router.post('/register', registerUser);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', loginUser);

/**
 * @swagger
 * /auth/google:
 *   post:
 *     summary: Login with Google
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - credential
 *             properties:
 *               credential:
 *                 type: string
 *     responses:
 *       200:
 *         description: Google login successful
 *       400:
 *         description: Email not verified by Google
 */
router.post('/google', googleLogin);

/**
 * @swagger
 * /auth/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *       401:
 *         description: Not authorized
 *       404:
 *         description: User not found
 */
router.get('/profile', protect, getUserProfile);

/**
 * @swagger
 * /auth/complete-profile:
 *   put:
 *     summary: Complete user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *               middleName:
 *                 type: string
 *               address:
 *                 type: string
 *               aptNumber:
 *                 type: string
 *               zipCode:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               country:
 *                 type: string
 *               organizationID:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Not authorized
 *       404:
 *         description: User not found
 */
router.put('/complete-profile', protect, completeUserProfile);

/**
 * @swagger
 * /auth/activities:
 *   get:
 *     summary: Get user activities
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User activities retrieved successfully
 *       401:
 *         description: Not authorized
 *       404:
 *         description: User not found
 */
router.get('/activities', protect, getUserActivities);

/**
 * @swagger
 * /auth/organizations:
 *   get:
 *     summary: Get user organizations
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User organizations retrieved successfully
 *       401:
 *         description: Not authorized
 *       404:
 *         description: User not found
 */
router.get('/organizations', protect, getUserOrganizations);

// PUT /api/auth/onboarding - Update onboarding status
router.put('/onboarding', protect, updateOnboardingStatus);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Not authorized
 */
router.post('/logout', protect, logoutUser);

//Update user status route
router.put('/status', protect, updateUserStatus);


// 2FA routes
router.post('/2fa/generate', protect, generate2FA);
router.post('/2fa/verify', protect, verify2FA);
router.post('/2fa/disable', protect, disable2FA);
router.post('/2fa/verify-login', verifyLogin2FA);

// Security settings routes
router.get('/security-settings', protect, getSecuritySettings);
router.post('/security-settings', protect, updateSecuritySettings);

// User status route
router.put('/status', protect, updateUserStatus);

router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/verify-reset-password', verifyResetPassword);

// GitHub OAuth routes
router.post('/github/initiate', initiateGitHubAuth);
router.post('/github/callback', handleGitHubCallback);
router.post('/github/disconnect', protect, disconnectGitHub);
router.get('/github/status/:userId', protect, getGitHubStatus);
router.get('/github/repositories/:userId', protect, getUserRepositories);

// Socket registration removed

module.exports = router; 