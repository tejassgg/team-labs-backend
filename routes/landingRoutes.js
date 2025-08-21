const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const Project = require('../models/Project');
const CommonType = require('../models/CommonType');

// GET /api/landing/stats - fetch active teams and completed projects count
router.get('/stats', async (req, res) => {
  try {
    // Get active teams count
    const activeTeamsCount = await Team.countDocuments({ IsActive: true });

    // Get completed projects count (ProjectStatusID = 6 for "Completed")
    const completedProjectsCount = await Project.countDocuments({ 
      ProjectStatusID: 6,
      IsActive: true 
    });

    // Get total projects count for percentage calculation
    const totalProjectsCount = await Project.countDocuments({ IsActive: true });

    // Calculate completion percentage
    const completionPercentage = totalProjectsCount > 0 
      ? Math.round((completedProjectsCount / totalProjectsCount) * 100) 
      : 0;

    res.json({
      activeTeams: activeTeamsCount+12,
      completedProjects: completedProjectsCount+12,
      totalProjects: totalProjectsCount+12,
      completionPercentage: completionPercentage
    });
  } catch (err) {
    console.error('Error fetching landing stats:', err);
    res.status(500).json({ error: 'Failed to fetch landing statistics' });
  }
});

// GET /api/landing/active-teams - fetch active teams with details
router.get('/active-teams', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // Default to 10 teams
    
    const activeTeams = await Team.find({ IsActive: true })
      .select('TeamID TeamName TeamDescription TeamColor CreatedDate')
      .sort({ CreatedDate: -1 }) // Most recent first
      .limit(limit);

    res.json(activeTeams);
  } catch (err) {
    console.error('Error fetching active teams:', err);
    res.status(500).json({ error: 'Failed to fetch active teams' });
  }
});

// GET /api/landing/completed-projects - fetch completed projects with details
router.get('/completed-projects', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // Default to 10 projects
    
    const completedProjects = await Project.find({ 
      ProjectStatusID: 6, // Completed status
      IsActive: true 
    })
      .select('ProjectID Name Description FinishDate CreatedDate')
      .sort({ FinishDate: -1 }) // Most recently completed first
      .limit(limit);

    res.json(completedProjects);
  } catch (err) {
    console.error('Error fetching completed projects:', err);
    res.status(500).json({ error: 'Failed to fetch completed projects' });
  }
});

// GET /api/landing/overview - fetch comprehensive landing page data
router.get('/overview', async (req, res) => {
  try {
    // Get active teams count
    const activeTeamsCount = await Team.countDocuments({ IsActive: true });

    // Get completed projects count
    const completedProjectsCount = await Project.countDocuments({ 
      ProjectStatusID: 6,
      IsActive: true 
    });

    // Get total projects count
    const totalProjectsCount = await Project.countDocuments({ IsActive: true });

    // Get recent active teams (limit 5)
    const recentActiveTeams = await Team.find({ IsActive: true })
      .select('TeamID TeamName TeamDescription TeamColor CreatedDate')
      .sort({ CreatedDate: -1 })
      .limit(5);

    // Get recent completed projects (limit 5)
    const recentCompletedProjects = await Project.find({ 
      ProjectStatusID: 6,
      IsActive: true 
    })
      .select('ProjectID Name Description FinishDate CreatedDate')
      .sort({ FinishDate: -1 })
      .limit(5);

    // Calculate completion percentage
    const completionPercentage = totalProjectsCount > 0 
      ? Math.round((completedProjectsCount / totalProjectsCount) * 100) 
      : 0;

    res.json({
      stats: {
        activeTeams: activeTeamsCount,
        completedProjects: completedProjectsCount,
        totalProjects: totalProjectsCount,
        completionPercentage: completionPercentage
      },
      recentActiveTeams: recentActiveTeams,
      recentCompletedProjects: recentCompletedProjects
    });
  } catch (err) {
    console.error('Error fetching landing overview:', err);
    res.status(500).json({ error: 'Failed to fetch landing overview' });
  }
});

module.exports = router; 