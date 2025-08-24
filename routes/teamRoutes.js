const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const User = require('../models/User');
const TeamDetails = require('../models/TeamDetails');
const TeamJoinRequest = require('../models/TeamJoinRequest');
const { logActivity } = require('../services/activityService');
const { checkTeamLimit } = require('../middleware/premiumLimits');
const { emitToOrg } = require('../socket');

// GET /api/teams/organization/:organizationId - fetch teams by organization
router.get('/organization/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const teams = await Team.find({organizationID: organizationId}).sort({ CreatedDate: -1 });
    
    res.json(teams);
  } catch (err) {
    console.error('Error fetching teams by organization:', err);
    res.status(500).json({ error: 'Failed to fetch teams by organization' });
  }
});

// GET /api/teams - fetch all teams
router.get('/:role/:userId', async (req, res) => {
  try {
    const role = req.params.role;
    const userId = req.params.userId;
    if (role === "Admin") {
      const teams = await Team.find();
      res.json(teams);
    }
    else {
      const teamDetails = await TeamDetails.find({
        MemberID: userId,
        IsMemberActive: true
      });
      const teamIds = teamDetails.map(td => td.TeamID_FK);
      const teams = await Team.find({
        TeamID: { $in: teamIds }
      });
      res.json(teams);
    }

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// POST /api/teams - add a new team
router.post('/', checkTeamLimit, async (req, res) => {
  try {
    const { TeamName, TeamDescription, TeamType, OwnerID } = req.body;
    if (!TeamName) return res.status(400).json({ error: 'Team Name is required' });
    if (typeof TeamType === 'undefined') return res.status(400).json({ error: 'Team Type is required' });
    if (!OwnerID) return res.status(401).json({ error: 'Unauthorized: OwnerID not found' });

    // Fetch the user to get their organizationID
    const user = await User.findById(OwnerID);
    if (!user) return res.status(401).json({ error: 'Unauthorized: User not found' });

    // Start a session for transaction
    const session = await Team.startSession();
    session.startTransaction();

    try {
      // Create the new team
      const newTeam = new Team({
        TeamName,
        TeamDescription,
        TeamType,
        OwnerID,
        organizationID: user.organizationID || '',
        IsActive: false,
        CreatedDate: new Date()
      });
      await newTeam.save({ session });

      // Add the owner as a member
      const newMember = new TeamDetails({
        TeamID_FK: newTeam.TeamID,
        MemberID: OwnerID,
        IsMemberActive: true,
        CreatedDate: new Date(),
        ModifiedBy: OwnerID
      });
      await newMember.save({ session });

      // Log the activity
      await logActivity(
        OwnerID,
        'team_create',
        'success',
        `Created new team "${TeamName}"`,
        req,
        {
          teamId: newTeam.TeamID,
          teamName: TeamName,
          teamType: TeamType
        }
      );

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      res.status(201).json({
        team: newTeam,
        message: 'Team created successfully with owner as member'
      });

      // Emit real-time team creation event
      try {
        emitToOrg(user.organizationID, 'team.created', {
          event: 'team.created',
          version: 1,
          data: { 
            organizationId: String(user.organizationID), 
            team: newTeam 
          },
          meta: { emittedAt: new Date().toISOString() }
        });

        // Emit dashboard metrics update
        const { emitDashboardMetrics } = require('../services/dashboardMetricsService');
        emitDashboardMetrics(user.organizationID);
      } catch (e) { /* ignore */ }
    } catch (error) {
      // If an error occurs, abort the transaction
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (err) {
    console.error('Error creating team:', err);
    // Log the error activity
    try {
      await logActivity(
        req.body.OwnerID,
        'team_create',
        'error',
        `Failed to create team: ${err.message}`,
        req,
        {
          teamName: req.body.TeamName,
          error: err.message
        }
      );
    } catch (logError) {
      console.error('Failed to log error activity:', logError);
    }
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// POST /api/teams/:teamId/join-request - create a join request
router.post('/:teamId/join-request', async (req, res) => {
  try {
    const { teamId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId is required' });
    
    // Prevent duplicate requests
    const existing = await TeamJoinRequest.findOne({ userId, teamId, status: 'pending' });
    if (existing) {
      return res.status(200).json({ message: 'Request already pending' });
    }

    const request = new TeamJoinRequest({ userId, teamId, status: 'pending' });
    await request.save();
    
    // Log the activity
    const team = await Team.findOne({ TeamID: teamId });
    await logActivity(
      userId,
      'team_join_request',
      'success',
      `Requested to join team "${team?.TeamName}"`,
      req,
      {
        teamId,
        teamName: team?.TeamName
      }
    );
    res.status(201).json(request);
  
    // Emit real-time join request event
    try {
      emitToOrg(team?.organizationID, 'team.join_request.created', {
        event: 'team.join_request.created',
        version: 1,
        data: { 
          organizationId: String(team?.organizationID), 
          teamId: teamId,
          request: request,
          user: await User.findById(userId).select('-password')
        },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (e) { 
      console.log(e);
     }
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to create join request' });
  }
});

// GET /api/teams/:teamId/join-requests - get all join requests for a team
router.get('/:teamId/join-requests', async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const requests = await TeamJoinRequest.find({ teamId, status: 'pending' }).populate('userId', 'name email');
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch join requests' });
  }
});

// POST /api/teams/:teamId/join-requests/:requestId/accept - accept a join request
router.post('/:teamId/join-requests/:requestId/accept', async (req, res) => {
  try {
    const { teamId, requestId } = req.params;
    const { adminId } = req.body;
    const request = await TeamJoinRequest.findById(requestId);
    if (!request || request.teamId.toString() !== teamId) return res.status(404).json({ message: 'Request not found' });
    request.status = 'accepted';
    request.respondedAt = new Date();
    request.respondedBy = adminId;
    await request.save();
    // Add user to TeamDetails
    const TeamDetails = require('../models/TeamDetails');
    await TeamDetails.create({ TeamID_FK: teamId, MemberID: request.userId, IsMemberActive: true, CreatedDate: new Date(), ModifiedBy: adminId });
    res.json({ message: 'Request accepted', request });

          // Emit real-time join request accepted event
      try {
        const team = await Team.findOne({ TeamID: teamId });
        emitToOrg(team?.organizationID, 'team.join_request.accepted', {
          event: 'team.join_request.accepted',
          version: 1,
          data: { 
            organizationId: String(team?.organizationID), 
            teamId: teamId,
            request: request,
            team: team
          },
          meta: { emittedAt: new Date().toISOString() }
        });

        // Emit dashboard metrics update
        const { emitDashboardMetrics } = require('../services/dashboardMetricsService');
        emitDashboardMetrics(team?.organizationID);
      } catch (e) { /* ignore */ }
  } catch (err) {
    res.status(500).json({ message: 'Failed to accept join request' });
  }
});

// POST /api/teams/:teamId/join-requests/:requestId/reject - reject a join request
router.post('/:teamId/join-requests/:requestId/reject', async (req, res) => {
  try {
    const { teamId, requestId } = req.params;
    const { adminId } = req.body;
    const request = await TeamJoinRequest.findById(requestId);
    if (!request || request.teamId.toString() !== teamId) return res.status(404).json({ message: 'Request not found' });
    request.status = 'rejected';
    request.respondedAt = new Date();
    request.respondedBy = adminId;
    await request.save();
    res.json({ message: 'Request rejected', request });

    // Emit real-time join request rejected event
    try {
      const team = await Team.findOne({ TeamID: teamId });
      emitToOrg(team?.organizationID, 'team.join_request.rejected', {
        event: 'team.join_request.rejected',
        version: 1,
        data: { 
          organizationId: String(team?.organizationID), 
          teamId: teamId,
          request: request,
          team: team
        },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (e) { /* ignore */ }
  } catch (err) {
    res.status(500).json({ message: 'Failed to reject join request' });
  }
});

// GET /api/teams/user/:userId/pending-requests - get user's pending join requests
router.get('/user/:userId/pending-requests', async (req, res) => {
  try {
    const { userId } = req.params;
    const pendingRequests = await TeamJoinRequest.find({ userId, status: 'pending' });
    
    // Extract team IDs from the pending requests
    const teamIds = pendingRequests.map(request => request.teamId);
    
    // Fetch team details for the pending requests
    const teams = await Team.find({ TeamID: { $in: teamIds } });
    
    // Combine request data with team details
    const requestsWithTeamDetails = pendingRequests.map(request => {
      const team = teams.find(t => t.TeamID === request.teamId);
      return {
        ...request.toObject(),
        teamDetails: team ? {
          TeamID: team.TeamID,
          TeamName: team.TeamName,
          TeamDescription: team.TeamDescription,
          organizationID: team.organizationID
        } : null
      };
    });
    
    res.json({ 
      pendingRequests: requestsWithTeamDetails, 
      teamIds 
    });
  } catch (error) {
    console.error('Error fetching user pending requests:', error);
    res.status(500).json({ message: 'Failed to fetch pending requests' });
  }
});

module.exports = router; 