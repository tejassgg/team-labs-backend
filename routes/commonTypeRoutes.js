const express = require('express');
const router = express.Router();
const CommonType = require('../models/CommonType');
const Organization = require('../models/Organization');

// GET /api/common-types/team-types
router.get('/team-types', async (req, res) => {
  try {
    const teamTypes = await CommonType.find({ MasterType: 'TeamType' });
    res.json(teamTypes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch team types' });
  }
});

// GET /api/common-types/organizations - Get all organizations
router.get('/organizations', async (req, res) => {
  try {
    const orgs = await CommonType.find({ MasterType: { $in: ['Organisation', 'Organization'] } });
    res.json(orgs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// GET /api/common-types/user-roles - Get all user roles
router.get('/user-roles', async (req, res) => {
  try {
    const roles = await CommonType.find({ MasterType: 'UserRole' }).sort({ Code: 1 });
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user roles' });
  }
});

router.get('/project-statuses', async (req, res) => {
  try {
    const statuses = await CommonType.find({ MasterType: 'ProjectStatus' }).sort({ Code: 1 });
    res.json(statuses);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project statuses' });
  }
});

// GET /api/common-types/phone-extensions - Get all Phone Extensions
router.get('/phone-extensions', async (req, res) => {
  try {
    const roles = await CommonType.find({ MasterType: 'PhoneExtension' }).sort({ Code: 1 });
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user roles' });
  }
});

// GET /api/common-types/task-types - Get all Task Type
router.get('/task-types', async (req, res) => {
  try {
    const taskTypes = await CommonType.find({ MasterType: 'TaskType' }).sort({ Code: 1 });
    res.json(taskTypes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch task types' });
  }
});

// GET /api/common-types/task-statuses - Get all Task Status
router.get('/task-statuses', async (req, res) => {
  try {
    const taskStatuses = await CommonType.find({ MasterType: 'TaskStatus' }).sort({ Code: 1 });
    res.json(taskStatuses);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch task statuses' });
  }
});

// GET /api/common-types/task-priorities - Get all Task Priority
router.get('/task-priorities', async (req, res) => {
  try {
    const taskPriorities = await CommonType.find({ MasterType: 'TaskPriority' }).sort({ Code: 1 });
    res.json(taskPriorities);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch task priorities' });
  }
});

// GET /api/common-types/subscription-features - Get subscription features by plan type
router.get('/subscription-features/:planType', async (req, res) => {
  try {
    const { planType } = req.params;
    const features = await CommonType.find({
      MasterType: 'SubscriptionFeatures',
      Description: planType
    }).sort({ Code: 1 });
    res.json(features);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscription features' });
  }
});

// GET /api/common-types/subscription-features - Get all subscription features
router.get('/subscription-features', async (req, res) => {
  try {
    const features = await CommonType.find({ MasterType: 'SubscriptionFeatures' }).sort({ Code: 1 });
    res.json(features);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscription features' });
  }
});

// GET /api/common-types/dropdown-data - Get orgs, roles, phone extensions
router.get('/dropdown-data', async (req, res) => {
  try {
    const organizations = await Organization.find({ IsActive: true });
    const userRoles = await CommonType.find({ MasterType: 'UserRole' });
    const phoneExtensions = await CommonType.find({ MasterType: 'PhoneExtension' });
    res.json({ organizations, userRoles, phoneExtensions });
  } catch (error) {
    console.error('Error fetching dropdown data:', error);
    res.status(500).json({ message: 'Failed to fetch dropdown data' });
  }
});

module.exports = router; 