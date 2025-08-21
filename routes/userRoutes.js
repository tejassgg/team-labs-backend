const express = require('express');
const router = express.Router();
const User = require('../models/User');
const TeamDetails = require('../models/TeamDetails');
const { protect } = require('../middleware/auth');
const { inviteUser, getInvites, resendInvite, deleteInvite, getUserOverview } = require('../controllers/userController');
const { emitToOrg } = require('../socket');

// GET /api/users/:userId/usage-limits - Get user's usage limits and premium status
router.get('/:userId/usage-limits', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const usageData = {
      isPremium: user.isPremiumMember && user.isSubscriptionActive(),
      subscriptionStatus: user.subscriptionStatus,
      subscriptionPlan: user.subscriptionPlan,
      subscriptionEndDate: user.subscriptionEndDate,
      usageLimits: {
        projectsCreated: user.usageLimits.projectsCreated,
        userStoriesCreated: user.usageLimits.userStoriesCreated,
        tasksCreated: user.usageLimits.tasksCreated
      },
      limits: {
        projects: 3,
        userStories: 3,
        tasks: 20
      },
      canCreate: {
        project: user.canCreateProject(),
        userStory: user.canCreateUserStory(),
        task: user.canCreateTask()
      }
    };

    res.json(usageData);
  } catch (err) {
    console.error('Error fetching user usage limits:', err);
    res.status(500).json({ error: 'Failed to fetch usage limits' });
  }
});

// PATCH /api/users/:userId/remove-from-org - Remove user from organization and all teams
router.patch('/:userId/remove-from-org', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { ModifiedBy } = req.body;

    // Find the user to be removed
    const userToRemove = await User.findById(userId);
    if (!userToRemove) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get the organization ID before removing it
    const organizationId = userToRemove.organizationID;

    // Start a session for transaction
    const session = await User.startSession();
    session.startTransaction();

    try {
      // 1. Remove user from all teams in the organization
      const teamDetails = await TeamDetails.find({ 
        MemberID: userId,
        TeamID_FK: { $exists: true }
      }).session(session);

      // Get all team IDs where the user is a member
      const teamIds = teamDetails.map(detail => detail.TeamID_FK);

      // Remove user from all teams
      await TeamDetails.deleteMany({
        MemberID: userId,
        TeamID_FK: { $in: teamIds }
      }).session(session);

      // 2. Update user's organizationID to null
      userToRemove.organizationID = null;
      userToRemove.ModifiedBy = ModifiedBy;
      userToRemove.ModifiedDate = new Date();
      await userToRemove.save({ session });

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      // Emit real-time removal event to org room
      try {
        emitToOrg(organizationId, 'org.member.removed', {
          event: 'org.member.removed',
          version: 1,
          data: { organizationId, userId },
          meta: { emittedAt: new Date().toISOString() }
        });
      } catch (e) { /* ignore */ }

      res.json({ 
        message: 'User removed from organization and all teams successfully',
        removedFromTeams: teamIds.length
      });

    } catch (error) {
      // If an error occurs, abort the transaction
      await session.abortTransaction();
      session.endSession();
      throw error;
    }

  } catch (err) {
    console.error('Error removing user from organization:', err);
    res.status(500).json({ error: 'Failed to remove user from organization' });
  }
});

// GET /api/users/overview - Get all user-related overview data at once
router.get('/overview', protect, getUserOverview);
router.post('/invite', protect, inviteUser);
router.get('/invites', protect, getInvites);
router.post('/invites/:inviteId/resend', protect, resendInvite);
router.delete('/invites/:inviteId', protect, deleteInvite);

module.exports = router; 