const Organization = require('../models/Organization');
const User = require('../models/User');
const CommonType = require('../models/CommonType');

// Helper to generate a unique OrganizationID (incremental or random)
async function generateUniqueOrganizationID() {
  let id;
  let exists = true;
  while (exists) {
    id = Math.floor(100000 + Math.random() * 900000); // 6-digit random
    exists = await Organization.findOne({ OrganizationID: id });
  }
  return id;
}

// POST /api/organizations
exports.createOrganization = async (req, res) => {
  try {
    const { Name } = req.body;
    if (!Name || !Name.trim()) {
      return res.status(400).json({ message: 'Organization name is required' });
    }
    const OwnerID = req.user._id;
    const OrganizationID = await generateUniqueOrganizationID();
    const org = new Organization({
      Name: Name.trim(),
      OwnerID,
      OrganizationID
    });
    await org.save();
    // Set the user's role to Admin
    await User.findByIdAndUpdate(OwnerID, { role: 'Admin' });
    // Fetch the updated user
    const updatedUser = await User.findById(OwnerID);
    res.status(201).json({ org, updatedUser });
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ message: 'Failed to create organization' });
  }
};