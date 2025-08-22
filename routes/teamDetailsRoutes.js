const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const TeamDetails = require('../models/TeamDetails');
const TeamJoinRequest = require('../models/TeamJoinRequest');
const User = require('../models/User');
const CommonType = require('../models/CommonType');
const ProjectDetails = require('../models/ProjectDetails');
const Project = require('../models/Project');
const UserActivity = require('../models/UserActivity');
const { logActivity } = require('../services/activityService');
const { emitToOrg } = require('../socket');

// Middleware to check if requester is the team owner
async function checkOwner(req, res, next) {
  const team = await Team.findOne({ TeamID: req.params.teamId });
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (req.body.OwnerID !== team.OwnerID) return res.status(403).json({ error: 'Only the team owner can perform this action' });
  
  req.team = team;
  next();
}

// GET /api/team-details/:teamId - Get team details with members and active projects
router.get('/:teamId', async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const team = await Team.findOne({ TeamID: teamId });
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Fetch team type value from CommonTypes
    const teamType = await CommonType.findOne({ 
      MasterType: 'TeamType',
      Code: team.TeamType 
    });

    // Fetch team members with their details
    const teamDetails = await TeamDetails.find({ TeamID_FK: teamId });
    const memberIds = teamDetails.map(detail => detail.MemberID);
    const users = await User.find({ _id: { $in: memberIds } });

    // Get last login timestamps for all members
    const lastLogins = await UserActivity.find({
      user: { $in: memberIds },
      type: 'login',
      status: 'success'
    }).sort({ timestamp: -1 });

    // Create a map of user's last login
    const lastLoginMap = {};
    lastLogins.forEach(login => {
      if (!lastLoginMap[login.user.toString()] || 
          new Date(login.timestamp) > new Date(lastLoginMap[login.user.toString()])) {
        lastLoginMap[login.user.toString()] = login.timestamp;
      }
    });

    // Combine team details with user information
    const members = teamDetails.map(detail => {
      const user = users.find(u => u._id.toString() === detail.MemberID);
      return {
        MemberID: detail.MemberID,
        TeamDetailsID: detail.TeamDetailsID,
        IsMemberActive: detail.IsMemberActive,
        name: user ? `${user.firstName} ${user.lastName}` : 'Unknown User',
        email: user ? user.email : '',
        lastLogin: lastLoginMap[detail.MemberID] || null,
        CreatedDate: detail.CreatedDate,
        ModifiedDate: detail.ModifiedDate
      };
    });

    // Fetch users from the same organization as the team owner
    const owner = await User.findById(team.OwnerID);
    if (!owner) return res.status(404).json({ error: 'Team owner not found' });

    const orgUsers = await User.find({ organizationID: owner.organizationID });

    // Fetch all projects for this team
    const assignments = await ProjectDetails.find({ TeamID: teamId });
    const projectIds = assignments.map(a => a.ProjectID);
    const projects = await Project.find({ ProjectID: { $in: projectIds } });
    const teamProjects = assignments.map(a => {
      const proj = projects.find(p => p.ProjectID === a.ProjectID);
      if (!proj) return null;
      return {
        ProjectID: proj.ProjectID,
        Name: proj.Name,
        AssignedDate: a.CreatedDate,
        FinishDate: proj.FinishDate,
        IsActive: proj.IsActive,
        TeamIsActive: a.IsActive,
        ProjectStatusID: proj.ProjectStatusID
      };
    }).filter(Boolean);

    // Fetch pending join requests for this team
    const pendingRequests = await TeamJoinRequest.find({ 
      teamId: teamId, 
      status: 'pending' 
    });

    // Fetch user details for all pending requests
    const requestUserIds = pendingRequests.map(req => req.userId);
    const requestUsers = await User.find({ _id: { $in: requestUserIds } });

    // Combine join requests with user details
    const pendingRequestsWithUserDetails = pendingRequests.map(request => {
      const user = requestUsers.find(u => u._id.toString() === request.userId);
      return {
        ...request.toObject(),
        userId: user ? {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          username: user.username,
          fullName: `${user.firstName} ${user.lastName}`.trim(),
          organizationID: user.organizationID,
          role: user.role,
          isActive: user.isActive,
          status: user.status
        } : null
      };
    });

    res.json({
      team: {
        ...team.toObject(),
        teamTypeValue: teamType ? teamType.Value : null
      },
      members,
      orgUsers,
      activeProjects: teamProjects,
      pendingRequests: pendingRequestsWithUserDetails
    });
  } catch (err) {
    console.error('Error fetching team details:', err);
    res.status(500).json({ error: 'Failed to fetch team details' });
  }
});

// POST /api/team-details/:teamId/add-member - Add member by UserID or email (owner only)
router.post('/:teamId/add-member', checkOwner, async (req, res) => {
  try {
    let { UserID, email } = req.body;
    if (!UserID && !email) return res.status(400).json({ error: 'UserID or email required' });
    if (!UserID && email) {
      const user = await User.findOne({ email });
      if (!user) return res.status(404).json({ error: 'User not found' });
      UserID = user._id.toString();
    }
    // Prevent duplicate
    const exists = await TeamDetails.findOne({ TeamID_FK: req.params.teamId, MemberID: UserID });
    if (exists) return res.status(400).json({ error: 'User already a member' });
    const newMember = new TeamDetails({
      TeamID_FK: req.params.teamId,
      MemberID: UserID,
      IsMemberActive: true,
      CreatedDate: new Date(),
      ModifiedBy: req.body.OwnerID
    });
    await newMember.save();
    res.status(201).json(newMember);

          // Emit real-time member added event
      try {
        const team = await Team.findOne({ TeamID: req.params.teamId });
        const user = await User.findById(UserID).select('-password');
        emitToOrg(team?.organizationID, 'team.member.added', {
          event: 'team.member.added',
          version: 1,
          data: { 
            organizationId: String(team?.organizationID), 
            teamId: req.params.teamId,
            member: newMember,
            user: user,
            team: team
          },
          meta: { emittedAt: new Date().toISOString() }
        });

        // Emit dashboard metrics update
        const { emitDashboardMetrics } = require('../services/dashboardMetricsService');
        emitDashboardMetrics(team?.organizationID);
      } catch (e) { /* ignore */ }
  } catch (err) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// PATCH /api/team-details/:teamId/member/:memberId/toggle - Toggle member active/inactive (owner only)
router.patch('/:teamId/member/:memberId/toggle', checkOwner, async (req, res) => {
  try {
    const member = await TeamDetails.findOne({ TeamID_FK: req.params.teamId, MemberID: req.params.memberId });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    member.IsMemberActive = !member.IsMemberActive;
    member.ModifiedDate = new Date();
    member.ModifiedBy = req.body.OwnerID;
    await member.save();
    res.json(member);

    // Emit real-time member status updated event
    try {
      const team = await Team.findOne({ TeamID: req.params.teamId });
      const user = await User.findById(req.params.memberId).select('-password');
      emitToOrg(team?.organizationID, 'team.member.status.updated', {
        event: 'team.member.status.updated',
        version: 1,
        data: { 
          organizationId: String(team?.organizationID), 
          teamId: req.params.teamId,
          member: member,
          user: user,
          team: team
        },
        meta: { emittedAt: new Date().toISOString() }
      });
    } catch (e) { /* ignore */ }
  } catch (err) {
    res.status(500).json({ error: 'Failed to update member status' });
  }
});

// PATCH /api/team-details/:teamId - Update team details
router.patch('/:teamId', checkOwner, async (req, res) => {
  try {
    const { TeamName, TeamDescription, TeamType, OwnerID } = req.body;
    if (!TeamName) return res.status(400).json({ error: 'Team name is required' });
    if (!OwnerID) return res.status(400).json({ error: 'Owner ID is required' });

    const team = await Team.findOne({ TeamID: req.params.teamId });
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Verify the requester is the owner
    if (team.OwnerID !== OwnerID) {
      return res.status(403).json({ error: 'Only the team owner can update the team details' });
    }

    // Update team fields
    team.TeamName = TeamName;
    team.TeamDescription = TeamDescription || team.TeamDescription;
    team.TeamType = TeamType || team.TeamType;
    team.ModifiedDate = new Date();
    team.ModifiedBy = OwnerID;
    await team.save();

    res.json(team);

          // Emit real-time team updated event
      try {
        emitToOrg(team.organizationID, 'team.updated', {
          event: 'team.updated',
          version: 1,
          data: { 
            organizationId: String(team.organizationID), 
            teamId: req.params.teamId,
            team: team
          },
          meta: { emittedAt: new Date().toISOString() }
        });

        // Emit dashboard metrics update
        const { emitDashboardMetrics } = require('../services/dashboardMetricsService');
        emitDashboardMetrics(team.organizationID);
      } catch (e) { /* ignore */ }
  } catch (err) {
    console.error('Error updating team details:', err);
    res.status(500).json({ error: 'Failed to update team details' });
  }
});

// PATCH /api/team-details/:teamId/toggle-status - Toggle team active/inactive (owner only)
router.patch('/:teamId/toggle-status', checkOwner, async (req, res) => {
  try {
    const team = await Team.findOne({ TeamID: req.params.teamId });
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const oldStatus = team.IsActive;
    team.IsActive = !team.IsActive;
    team.ModifiedDate = new Date();
    team.ModifiedBy = req.body.OwnerID;
    await team.save();

          // Emit real-time team status updated event
      try {
        emitToOrg(team.organizationID, 'team.status.updated', {
          event: 'team.status.updated',
          version: 1,
          data: { 
            organizationId: String(team.organizationID), 
            teamId: req.params.teamId,
            team: team,
            oldStatus: oldStatus,
            newStatus: team.IsActive
          },
          meta: { emittedAt: new Date().toISOString() }
        });

        // Emit dashboard metrics update
        const { emitDashboardMetrics } = require('../services/dashboardMetricsService');
        emitDashboardMetrics(team.organizationID);
      } catch (e) { /* ignore */ }

    // Log the activity
    await logActivity(
      req.body.OwnerID,
      'team_status_update',
      'success',
      `${team.IsActive ? 'Activated' : 'Deactivated'} team "${team.TeamName}"`,
      req,
      {
        teamId: team.TeamID,
        teamName: team.TeamName,
        oldStatus,
        newStatus: team.IsActive
      }
    );

    res.json(team);
  } catch (err) {
    console.error('Error toggling team status:', err);
    // Log the error activity
    try {
      await logActivity(
        req.body.OwnerID,
        'team_status_update',
        'error',
        `Failed to update team status: ${err.message}`,
        req,
        {
          teamId: req.params.teamId,
          error: err.message
        }
      );
    } catch (logError) {
      console.error('Failed to log error activity:', logError);
    }
    res.status(500).json({ error: 'Failed to update team status' });
  }
});

// DELETE /api/team-details/:teamId/member/:memberId - Remove member from team (owner only)
router.delete('/:teamId/member/:memberId', checkOwner, async (req, res) => {
  try {
    const member = await TeamDetails.findOne({ 
      TeamID_FK: req.params.teamId, 
      MemberID: req.params.memberId 
    });
    
    if (!member) {
      return res.status(404).json({ error: 'Member not found in team' });
    }

    // Prevent removing the team owner
    const team = await Team.findOne({ TeamID: req.params.teamId });
    if (req.params.memberId === team.OwnerID) {
      return res.status(400).json({ error: 'Cannot remove the team owner' });
    }

    await member.deleteOne();
    res.json({ message: 'Member removed successfully' });

          // Emit real-time member removed event
      try {
        const team = await Team.findOne({ TeamID: req.params.teamId });
        const user = await User.findById(req.params.memberId).select('-password');
        emitToOrg(team?.organizationID, 'team.member.removed', {
          event: 'team.member.removed',
          version: 1,
          data: { 
            organizationId: String(team?.organizationID), 
            teamId: req.params.teamId,
            memberId: req.params.memberId,
            user: user,
            team: team
          },
          meta: { emittedAt: new Date().toISOString() }
        });

        // Emit dashboard metrics update
        const { emitDashboardMetrics } = require('../services/dashboardMetricsService');
        emitDashboardMetrics(team?.organizationID);
      } catch (e) { /* ignore */ }
  } catch (err) {
    console.error('Error removing member:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// GET /api/team-details/:teamId/active-projects - List all projects for a team
router.get('/:teamId/active-projects', async (req, res) => {
  try {
    const teamId = req.params.teamId;
    // Find all project assignments for this team
    const assignments = await ProjectDetails.find({ TeamID: teamId });
    const projectIds = assignments.map(a => a.ProjectID);
    // Fetch project info for each assignment
    const projects = await Project.find({ ProjectID: { $in: projectIds } });
    // Map to include assigned date from ProjectDetails
    const result = assignments.map(a => {
      const proj = projects.find(p => p.ProjectID === a.ProjectID);
      if (!proj) return null;
      return {
        ProjectID: proj.ProjectID,
        Name: proj.Name,
        AssignedDate: a.CreatedDate,
        FinishDate: proj.FinishDate,
        IsActive: proj.IsActive,
        TeamIsActive: a.IsActive
      };
    }).filter(Boolean);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch projects for team' });
  }
});

// DELETE /api/team-details/:teamId - delete a team
router.delete('/:teamId', checkOwner, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { userId } = req.body;

    // Find the team and verify ownership
    const team = await Team.findOne({ TeamID: teamId });
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Start a session for transaction
    const session = await Team.startSession();
    session.startTransaction();

    try {
      // Delete team details (members)
      await TeamDetails.deleteMany({ TeamID_FK: teamId }, { session });
      
      // Delete the team
      await Team.deleteOne({ TeamID: teamId }, { session });

      // Log the activity
      await logActivity(
        userId,
        'team_delete',
        'success',
        `Deleted team "${team.TeamName}"`,
        req,
        {
          teamId: team.TeamID,
          teamName: team.TeamName,
          teamType: team.TeamType
        }
      );

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      res.json({ message: 'Team deleted successfully' });

      // Emit real-time team deleted event
      try {
        emitToOrg(team.organizationID, 'team.deleted', {
          event: 'team.deleted',
          version: 1,
          data: { 
            organizationId: String(user.organizationID), 
            teamId: req.params.teamId,
            team: team
          },
          meta: { emittedAt: new Date().toISOString() }
        });

        // Emit dashboard metrics update
        const { emitDashboardMetrics } = require('../services/dashboardMetricsService');
        emitDashboardMetrics(team.organizationID);
      } catch (e) { /* ignore */ }
    } catch (error) {
      // If an error occurs, abort the transaction
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (err) {
    console.error('Error deleting team:', err);
    // Log the error activity
    try {
      await logActivity(
        req.body.userId,
        'team_delete',
        'error',
        `Failed to delete team: ${err.message}`,
        req,
        {
          teamId: req.params.teamId,
          error: err.message
        }
      );
    } catch (logError) {
      console.error('Failed to log error activity:', logError);
    }
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

// DELETE /api/team-details/:teamId/members/remove-members - Remove multiple members from team (owner only)
router.delete('/:teamId/members/remove-members', checkOwner, async (req, res) => {
  try {
    const { memberIds } = req.body;
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: 'Member IDs array is required' });
    }

    const team = await Team.findOne({ TeamID: req.params.teamId });
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Prevent removing the team owner
    if (memberIds.includes(team.OwnerID)) {
      return res.status(400).json({ error: 'Cannot remove the team owner' });
    }

    // Remove all specified members
    const result = await TeamDetails.deleteMany({
      TeamID_FK: req.params.teamId,
      MemberID: { $in: memberIds }
    });

    // Log the activity
    await logActivity(
      req.body.OwnerID,
      'team_members_remove',
      'success',
      `Removed ${result.deletedCount} members from team "${team.TeamName}"`,
      req,
      {
        teamId: team.TeamID,
        teamName: team.TeamName,
        removedCount: result.deletedCount
      }
    );

    res.json({ 
      message: `Successfully removed ${result.deletedCount} members`,
      removedCount: result.deletedCount
    });

          // Emit real-time bulk members removed event
      try {
        emitToOrg(team.organizationID, 'team.members.bulk_removed', {
          event: 'team.members.bulk_removed',
          version: 1,
          data: { 
            organizationId: String(team.organizationID), 
            teamId: req.params.teamId,
            team: team,
            removedCount: result.deletedCount,
            removedMemberIds: memberIds
          },
          meta: { emittedAt: new Date().toISOString() }
        });

        // Emit dashboard metrics update
        const { emitDashboardMetrics } = require('../services/dashboardMetricsService');
        emitDashboardMetrics(team.organizationID);
      } catch (e) { /* ignore */ }
  } catch (err) {
    console.error('Error removing members:', err);
    // Log the error activity
    try {
      await logActivity(
        req.body.OwnerID,
        'team_members_remove',
        'error',
        `Failed to remove members: ${err.message}`,
        req,
        {
          teamId: req.params.teamId,
          error: err.message
        }
      );
    } catch (logError) {
      console.error('Failed to log error activity:', logError);
    }
    res.status(500).json({ error: 'Failed to remove members' });
  }
});

// DELETE /api/team-details/:teamId/projects/remove-projects - Remove multiple projects from team (owner only)
router.delete('/:teamId/projects/remove-projects', checkOwner, async (req, res) => {
  try {
    const { projectIds } = req.body;
    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      return res.status(400).json({ error: 'Project IDs array is required' });
    }

    const team = await Team.findOne({ TeamID: req.params.teamId });
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }


    // Start a session for transaction
    const session = await ProjectDetails.startSession();
    session.startTransaction();

    try {
      // Remove all specified projects from this team
      const result = await ProjectDetails.deleteMany({
        TeamID: req.params.teamId,
        ProjectID: { $in: projectIds }
      }, { session });

      // For each removed project, check if it has any remaining teams
      const projectsToUpdate = [];
      for (const projectId of projectIds) {
        const remainingTeams = await ProjectDetails.countDocuments({
          ProjectID: projectId
        }, { session });

        // If no teams are assigned, update project status to 1 (Unassigned)
        if (remainingTeams === 0) {
          projectsToUpdate.push(projectId);
        }
      }

      // Update status of projects with no teams
      if (projectsToUpdate.length > 0) {
        await Project.updateMany(
          { ProjectID: { $in: projectsToUpdate } },
          { 
            $set: { 
              ProjectStatusID: 1, // Set to Unassigned status
              ModifiedDate: new Date(),
              ModifiedBy: req.body.OwnerID
            }
          },
          { session }
        );
      }

      // Log the activity
      await logActivity(
        req.body.OwnerID,
        'team_projects_remove',
        'success',
        `Removed ${result.deletedCount} projects from team "${team.TeamName}"${projectsToUpdate.length > 0 ? ` and updated ${projectsToUpdate.length} project(s) to unassigned status` : ''}`,
        req,
        {
          teamId: team.TeamID,
          teamName: team.TeamName,
          removedCount: result.deletedCount,
          updatedToUnassigned: projectsToUpdate.length
        }
      );

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      res.json({ 
        message: `Successfully removed ${result.deletedCount} projects${projectsToUpdate.length > 0 ? ` and updated ${projectsToUpdate.length} project(s) to unassigned status` : ''}`,
        removedCount: result.deletedCount,
        updatedToUnassigned: projectsToUpdate.length
      });

      // Emit real-time bulk projects removed event
      try {
        emitToOrg(team.organizationID, 'team.projects.bulk_removed', {
          event: 'team.projects.bulk_removed',
          version: 1,
          data: { 
            organizationId: String(team.organizationID), 
            teamId: req.params.teamId,
            team: team,
            removedCount: result.deletedCount,
            removedProjectIds: projectIds,
            updatedToUnassigned: projectsToUpdate.length
          },
          meta: { emittedAt: new Date().toISOString() }
        });

        // Emit dashboard metrics update
        const { emitDashboardMetrics } = require('../services/dashboardMetricsService');
        emitDashboardMetrics(team.organizationID);
      } catch (e) { /* ignore */ }
    } catch (error) {
      // If an error occurs, abort the transaction
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (err) {
    console.error('Error removing projects:', err);
    // Log the error activity
    try {
      await logActivity(
        req.body.OwnerID,
        'team_projects_remove',
        'error',
        `Failed to remove projects: ${err.message}`,
        req,
        {
          teamId: req.params.teamId,
          error: err.message
        }
      );
    } catch (logError) {
      console.error('Failed to log error activity:', logError);
    }
    res.status(500).json({ error: 'Failed to remove projects' });
  }
});

module.exports = router; 