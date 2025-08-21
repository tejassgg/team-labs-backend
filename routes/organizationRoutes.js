const express = require('express');
const router = express.Router();
const { createOrganization, getDropdownData } = require('../controllers/organizationController');
const { protect } = require('../middleware/auth');

// POST /api/organizations - Create a new organization
router.post('/', protect, createOrganization);

module.exports = router; 