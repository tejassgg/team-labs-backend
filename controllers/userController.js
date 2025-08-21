const User = require('../models/User');
const Team = require('../models/Team');
const TeamDetails = require('../models/TeamDetails');
const Project = require('../models/Project');
const TaskDetails = require('../models/TaskDetails');
const CommonType = require('../models/CommonType');
const Invite = require('../models/Invite');
const crypto = require('crypto');
const emailService = require('../services/emailService');
const Organization = require('../models/Organization');
const { emitToOrg } = require('../socket');

exports.updateUser = async (req, res) => {
  try {
    const { firstName, lastName, phone, phoneExtension, address, city, state, zipCode, country } = req.body;
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user fields
    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.phone = phone || user.phone;
    user.phoneExtension = phoneExtension || user.phoneExtension;
    user.address = address || user.address;
    user.city = city || user.city;
    user.state = state || user.state;
    user.zipCode = zipCode || user.zipCode;
    user.country = country || user.country;

    await user.save();

    // Emit org.member.updated if user belongs to an organization
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
              email: user.email,
              status: user.status || 'Active'
            }
          },
          meta: { emittedAt: new Date().toISOString() }
        });
      }
    } catch (e) { /* ignore */ }

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        phoneExtension: user.phoneExtension,
        address: user.address,
        city: user.city,
        state: user.state,
        zipCode: user.zipCode,
        country: user.country,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Error updating user profile' });
  }
};

// New: Get all user overview data in one API
exports.getUserOverview = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean().select('-password -googleId');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Teams: user is owner or member
    const memberTeamDetails = await TeamDetails.find({ MemberID: user._id, IsMemberActive: true });
    const memberTeamIds = memberTeamDetails.map(td => td.TeamID_FK);
    const teams = await Team.find({
      $or: [
        { OwnerID: user._id },
        { TeamID: { $in: memberTeamIds } }
      ]
    }).lean();

    // Projects: user is owner or in user's org
    const projects = await Project.find({
      $or: [
        { ProjectOwner: user._id },
        { OrganizationID: user.organizationID }
      ]
    }).lean();

    const organization = await Organization.findOne({
      OrganizationID: user.organizationID
    });

    // Tasks: assigned to user or created by user
    const tasks = await TaskDetails.find({
      $or: [
        { AssignedTo: user._id },
        { CreatedBy: user._id }
      ],
      IsActive: true
    }).lean();

    // Project Statuses (from CommonType)
    const projectStatuses = await CommonType.find({ MasterType: 'ProjectStatus' }).lean();

    res.json({
      user,
      teams,
      projects,
      organization,
      tasks,
      projectStatuses,
      onboardingCompleted: user.onboardingCompleted,
      onboardingStep: user.onboardingStep,
      onboardingProgress: user.onboardingProgress
    });
  } catch (error) {
    console.error('Error fetching user overview:', error);
    res.status(500).json({ message: 'Error fetching user overview' });
  }
}; 

// Get all invites for organization
exports.getInvites = async (req, res) => {
  try {
    const organizationID = req.user.organizationID;
    const invites = await Invite.find({ organizationID })
      .populate('inviter', 'firstName lastName email')
      .sort({ createdAt: -1 });

    // Update expired invites
    const updatedInvites = invites.map(invite => {
      if (invite.status === 'Pending' && invite.isExpired()) {
        invite.status = 'Expired';
        invite.save();
      }
      return invite;
    });

    res.json(updatedInvites);
  } catch (err) {
    console.error('Get invites error:', err);
    res.status(500).json({ message: 'Failed to fetch invites' });
  }
};

// Resend invite
exports.resendInvite = async (req, res) => {
  try {
    const { inviteId } = req.params;
    const invite = await Invite.findById(inviteId);
    
    if (!invite) {
      return res.status(404).json({ message: 'Invite not found' });
    }

    if (invite.status !== 'Pending') {
      return res.status(400).json({ message: 'Can only resend pending invites' });
    }

    if (invite.isExpired()) {
      return res.status(400).json({ message: 'Invite has expired' });
    }

    // Generate new token and update expiration
    const crypto = require('crypto');
    invite.token = crypto.randomBytes(32).toString('hex');
    invite.expiredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await invite.save();

    // Send new invite email
    const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/register?invite=${invite.token}`;
    await emailService.sendInviteEmail(invite.email, inviteLink, req.user.firstName || 'A TeamLabs Admin');

    res.json({ message: 'Invite resent successfully', invite });
  } catch (err) {
    console.error('Resend invite error:', err);
    res.status(500).json({ message: 'Failed to resend invite' });
  }
};

// Delete/Cancel invite
exports.deleteInvite = async (req, res) => {
  try {
    const { inviteId } = req.params;
    const invite = await Invite.findById(inviteId);
    
    if (!invite) {
      return res.status(404).json({ message: 'Invite not found' });
    }

    if (invite.status === 'Accepted') {
      return res.status(400).json({ message: 'Cannot delete accepted invite' });
    }

    await Invite.findByIdAndDelete(inviteId);
    res.json({ message: 'Invite deleted successfully' });
  } catch (err) {
    console.error('Delete invite error:', err);
    res.status(500).json({ message: 'Failed to delete invite' });
  }
};

// Invite user to organization
exports.inviteUser = async (req, res) => {
  try {
    const { email } = req.body;
    const inviter = req.user._id;
    const organizationID = req.user.organizationID;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    // Check if already invited (pending or not expired)
    const existing = await Invite.findOne({ 
      email, 
      organizationID, 
      status: 'Pending',
      expiredAt: { $gt: new Date() }
    });
    if (existing) return res.status(409).json({ message: 'User already invited', invite: existing });

    // Generate token
    const token = crypto.randomBytes(32).toString('hex');
    const invite = await Invite.create({ email, organizationID, inviter, token });

    // Send invite email
    const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/register?invite=${token}`;
    await emailService.sendInviteEmail(email, inviteLink, req.user.firstName || 'A TeamLabs Admin');

    res.status(201).json({ message: 'Invite sent', invite });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ message: 'Failed to send invite' });
  }
}; 