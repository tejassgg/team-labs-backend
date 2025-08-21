const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const Team = require('../models/Team');
const User = require('../models/User');
const CommonType = require('../models/CommonType');
const UserActivity = require('../models/UserActivity');
const TaskDetails = require('../models/TaskDetails');
const Invite = require('../models/Invite');
const Organization = require('../models/Organization');

// Get dashboard statistics
router.get('/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;

    // Get all projects in the organization
    const projects = await Project.find({ OrganizationID: organizationId });
    
    // Get all teams in the organization
    const teams = await Team.find({ organizationID: organizationId });
    
    // Get all users in the organization
    const users = await User.find({ organizationID: organizationId });

    // Get all invites for the organization
    const invites = await Invite.find({ organizationID: organizationId })
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

    // Get all tasks in the organization
    const tasks = await TaskDetails.find({ 
      ProjectID_FK: { $in: projects.map(p => p.ProjectID) }
    });

    // Get last login timestamps for all users
    const lastLogins = await UserActivity.find({
      user: { $in: users.map(u => u._id) },
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

    // Calculate upcoming deadlines (projects due today or in the future)
    const now = new Date();
    
    const upcomingDeadlines = projects.filter(project => {
      if (!project.FinishDate) return false;
      const finish = new Date(project.FinishDate);
      const diff = finish - now;
      return diff > 0; // Only include projects that haven't passed their deadline
    });

    // Get organization details
    const organization = await Organization.findOne({OrganizationID: organizationId});
    const projStatus = await CommonType.find({MasterType: 'ProjectStatus'});

    // Calculate project status distribution
    const projectStatusDistribution = {};
    projects.forEach(project => {
      const status = projStatus.find(item => item.Code === project.ProjectStatusID)?.Value || 'Unknown Status';
      projectStatusDistribution[status] = (projectStatusDistribution[status] || 0) + 1;
    });

    // Calculate task type distribution
    const taskTypeDistribution = {};
    tasks.forEach(task => {
      taskTypeDistribution[task.Type] = (taskTypeDistribution[task.Type] || 0) + 1;
    });

    // Calculate monthly activity (last 12 months)
    const monthlyActivity = {
      projectsCreated: Array(12).fill(0),
      tasksCompleted: Array(12).fill(0)
    };

    const currentYear = new Date().getFullYear();
    projects.forEach(project => {
      const createdDate = new Date(project.CreatedDate);
      if (createdDate.getFullYear() === currentYear) {
        const month = createdDate.getMonth();
        monthlyActivity.projectsCreated[month]++;
      }
    });

    // Get completed tasks (assuming status 5 or higher means completed)
    const completedTasks = tasks.filter(task => task.Status >= 5);
    completedTasks.forEach(task => {
      const createdDate = new Date(task.CreatedDate);
      if (createdDate.getFullYear() === currentYear) {
        const month = createdDate.getMonth();
        monthlyActivity.tasksCompleted[month]++;
      }
    });

    // Calculate team performance metrics
    const teamPerformance = teams.map(team => {
      const teamProjects = projects.filter(project => 
        project.ProjectOwner === team.OwnerID || 
        project.OrganizationID === team.organizationID
      );
      
      return {
        teamId: team.TeamID,
        teamName: team.TeamName,
        memberCount: team.members?.length || 0,
        activeProjects: teamProjects.filter(p => p.IsActive).length,
        totalProjects: teamProjects.length
      };
    });

    // Get recent activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentActivity = await UserActivity.find({
      user: { $in: users.map(u => u._id) },
      timestamp: { $gte: thirtyDaysAgo }
    }).sort({ timestamp: -1 }).limit(50);

    // Calculate activity by type
    const activityByType = {};
    recentActivity.forEach(activity => {
      activityByType[activity.type] = (activityByType[activity.type] || 0) + 1;
    });

    // Prepare dashboard statistics
    const dashboardStats = {
      totalProjects: projects.length,
      totalTeams: teams.length,
      totalUsers: users.length,
      upcomingDeadlines: upcomingDeadlines.length,
      organizationName: organization?.Name || 'Unknown Organization',
      recentProjects: projects.slice(0, 5).map(project => ({
        id: project.ProjectID,
        name: project.Name,
        deadline: project.FinishDate,
        isActive: project.IsActive,
        projectStatusId: project.ProjectStatusID,
        projectStatus: projStatus.find(item => item.Code === project.ProjectStatusID)?.Value || 'Unknown Status',
        description: project.Description
      })),
      recentTeams: teams.slice(0, 5).map(team => ({
        id: team._id,
        name: team.TeamName,
        memberCount: team.members?.length || 0
      })),
      deadlineDetails: upcomingDeadlines.map(project => {
        const finish = new Date(project.FinishDate);
        const diff = finish - now;
        const daysRemaining = Math.floor(diff / (1000 * 60 * 60 * 24));
        return {
          id: project._id,
          name: project.Name,
          deadline: project.FinishDate,
          daysRemaining: daysRemaining
        };
      }),
      members: users.map(user => {
        return {
          id: user._id,
          name: `${user.firstName} ${user.lastName}`.trim(),
          email: user.email || 'No email',
          isActive: user.isActive || false,
          role: user.role || 'User',
          initials: `${user.firstName[0] || ''}${user.lastName[0] || ''}`.toUpperCase() || 'U',
          lastLogin: lastLoginMap[user._id.toString()] || null,
          status: user.status || (user.isActive ? 'Active' : 'Offline'),
          username: user.username || 'No username'
        };
      }),
      invites: updatedInvites.map(invite => ({
        _id: invite._id,
        email: invite.email,
        status: invite.status,
        invitedAt: invite.invitedAt,
        expiredAt: invite.expiredAt,
        acceptedAt: invite.acceptedAt,
        inviter: invite.inviter ? {
          firstName: invite.inviter.firstName,
          lastName: invite.inviter.lastName,
          email: invite.inviter.email
        } : null
      })),
      // Chart data
      charts: {
        projectStatusDistribution,
        taskTypeDistribution,
        monthlyActivity,
        teamPerformance,
        activityByType,
        totalTasks: tasks.length,
        completedTasks: completedTasks.length,
        activeTasks: tasks.filter(task => task.Status < 5).length
      }
    };

    res.json(dashboardStats);
  } catch (error) {
    console.error('Error fetching dashboard details:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard details' });
  }
});

module.exports = router; 