const Project = require('../models/Project');
const Team = require('../models/Team');
const User = require('../models/User');
const CommonType = require('../models/CommonType');
const UserActivity = require('../models/UserActivity');
const TaskDetails = require('../models/TaskDetails');
const Invite = require('../models/Invite');
const { emitToOrg } = require('../socket');

async function buildDashboardStats(organizationId) {
  // Projects, Teams, Users
  const [projects, teams, users, projStatus] = await Promise.all([
    Project.find({ OrganizationID: organizationId }),
    Team.find({ organizationID: organizationId }),
    User.find({ organizationID: organizationId }),
    CommonType.find({ MasterType: 'ProjectStatus' })
  ]);

  const tasks = await TaskDetails.find({
    ProjectID_FK: { $in: projects.map(p => p.ProjectID) }
  });

  // Status Distribution
  const projectStatusDistribution = {};
  projects.forEach(project => {
    const status = projStatus.find(item => item.Code === project.ProjectStatusID)?.Value || 'Unknown Status';
    projectStatusDistribution[status] = (projectStatusDistribution[status] || 0) + 1;
  });

  // Task Type Distribution
  const taskTypeDistribution = {};
  tasks.forEach(task => {
    taskTypeDistribution[task.Type] = (taskTypeDistribution[task.Type] || 0) + 1;
  });

  // Monthly Activity (current year)
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
  const completedTasks = tasks.filter(task => task.Status >= 5);
  completedTasks.forEach(task => {
    const createdDate = new Date(task.CreatedDate);
    if (createdDate.getFullYear() === currentYear) {
      const month = createdDate.getMonth();
      monthlyActivity.tasksCompleted[month]++;
    }
  });

  // Team Performance
  const teamPerformance = teams.map(team => {
    const teamProjects = projects.filter(project =>
      project.ProjectOwner === team.OwnerID || project.OrganizationID === team.organizationID
    );
    return {
      teamId: team.TeamID,
      teamName: team.TeamName,
      memberCount: team.members?.length || 0,
      activeProjects: teamProjects.filter(p => p.IsActive).length,
      totalProjects: teamProjects.length
    };
  });

  // Recent Activity (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentActivity = await UserActivity.find({
    user: { $in: users.map(u => u._id) },
    timestamp: { $gte: thirtyDaysAgo }
  }).sort({ timestamp: -1 }).limit(50);
  const activityByType = {};
  recentActivity.forEach(activity => {
    activityByType[activity.type] = (activityByType[activity.type] || 0) + 1;
  });

  // KPIs and charts subset
  const metrics = {
    totalProjects: projects.length,
    totalTeams: teams.length,
    totalUsers: users.length,
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

  return metrics;
}

async function emitDashboardMetrics(organizationId) {
  const metrics = await buildDashboardStats(organizationId);
  emitToOrg(organizationId, 'dashboard.metrics.updated', {
    event: 'dashboard.metrics.updated',
    version: 1,
    data: {
      organizationId: String(organizationId),
      metrics
    },
    meta: { emittedAt: new Date().toISOString() }
  });
}

module.exports = {
  buildDashboardStats,
  emitDashboardMetrics
};


