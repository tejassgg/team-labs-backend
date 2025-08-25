const express = require('express');
const router = express.Router();
const TaskDetails = require('../models/TaskDetails');
const User = require('../models/User');
const TeamDetails = require('../models/TeamDetails');
const Team = require('../models/Team');
const ProjectDetails = require('../models/ProjectDetails');
const TaskDetailsHistory = require('../models/TaskDetailsHistory');
const Project = require('../models/Project');
const CommonType = require('../models/CommonType');
const { logActivity } = require('../services/activityService');
const { sendTaskAssignmentEmail } = require('../services/emailService');
const { emitToProject, emitToTask } = require('../socket');
const Attachment = require('../models/Attachment');
const Comment = require('../models/Comment');
const UserActivity = require('../models/UserActivity');
const { checkUserStoryLimit, checkTaskLimit, incrementUsage } = require('../middleware/premiumLimits');
const { emitDashboardMetrics } = require('../services/dashboardMetricsService');
const Subtask = require('../models/Subtask');

// Middleware to check limits based on task type
const checkTaskTypeLimit = async (req, res, next) => {
    const taskType = req.body.taskDetail?.Type;

    if (taskType === 'User Story') {
        return checkUserStoryLimit(req, res, next);
    } else if (taskType) {
        return checkTaskLimit(req, res, next);
    }

    next();
};

// POST /api/task-details - Create a new task
router.post('/', checkTaskTypeLimit, async (req, res) => {
    try {
        const taskData = req.body.taskDetail;
        const mode = req.body.mode;

        taskData.CreatedDate = new Date();
        if (taskData.Type == "User Story") {
            taskData.Assignee = "";
            taskData.AssignedDate = "";
            taskData.Status = 2;
        }
        else { taskData.Status = 1; }
        taskData.IsActive = true;
        taskData.CreatedBy = taskData.Assignee;
        const newTaskDetail = new TaskDetails(taskData);
        const savedTaskDetail = await newTaskDetail.save();

        const newTask = savedTaskDetail.toObject();

        // Increment usage for non-premium users
        await incrementUsage(req, res, () => { });

        // Fetch assignee details if exists
        if (newTask.Assignee) {
            try {
                const assignee = await User.findById(newTask.Assignee);
                if (assignee) {
                    const teamDetails = await TeamDetails.findOne({ MemberID: assignee._id });
                    let teamName = null;
                    if (teamDetails) {
                        const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                        teamName = team ? team.TeamName : null;
                    }
                    newTask.AssigneeDetails = {
                        _id: assignee._id,
                        username: assignee.username,
                        fullName: assignee.firstName + " " + assignee.lastName,
                        email: assignee.email,
                        teamName: teamName
                    };
                }
            } catch (error) {
                console.error('Error fetching assignee details:', error);
            }
        }

        // Fetch assignedTo details if exists
        if (newTask.AssignedTo) {
            try {
                const assignedTo = await User.findById(newTask.AssignedTo);
                if (assignedTo) {
                    const teamDetails = await TeamDetails.findOne({ MemberID: assignedTo._id });
                    let teamName = null;
                    if (teamDetails) {
                        const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                        teamName = team ? team.TeamName : null;
                    }
                    newTask.AssignedToDetails = {
                        _id: assignedTo._id,
                        username: assignedTo.username,
                        fullName: assignedTo.firstName + " " + assignedTo.lastName,
                        email: assignedTo.email,
                        teamName: teamName
                    };
                }
            } catch (error) {
                console.error('Error fetching assignedTo details:', error);
            }
        }

        // Log the activity
        await logActivity(
            taskData.CreatedBy,
            taskData.Type === 'User Story' ? 'user_story_create' : 'task_create',
            'success',
            `Created new ${taskData.Type.toLowerCase()} "${taskData.Name}"`,
            req,
            {
                taskId: newTask.TaskID,
                taskName: taskData.Name,
                taskType: taskData.Type,
                projectId: taskData.ProjectID_FK,
                status: taskData.Status,
                assignee: taskData.Assignee
            }
        );

        // Emit kanban create event
        try {
            emitToProject(newTask.ProjectID_FK, 'kanban.task.created', {
                event: 'kanban.task.created',
                version: 1,
                data: { projectId: newTask.ProjectID_FK, task: newTask },
                meta: { emittedAt: new Date().toISOString() }
            });
        } catch (e) {}

        // Send email notification if task is assigned during creation
        if (newTask.AssignedTo && newTask.AssignedToDetails) {
            try {
                const createdByUser = await User.findById(taskData.CreatedBy);
                const assignedBy = createdByUser ? `${createdByUser.firstName} ${createdByUser.lastName}` : 'Unknown User';

                const taskDetails = `
                    <strong>Task Name:</strong> ${newTask.Name}<br>
                    <strong>Description:</strong> ${newTask.Description || 'No description provided'}<br>
                    <strong>Type:</strong> ${newTask.Type}<br>
                    <strong>Priority:</strong> ${newTask.Priority || 'Not set'}<br>
                    <strong>Status:</strong> ${newTask.Status === 1 ? 'Not Assigned' : newTask.Status === 2 ? 'Assigned' : newTask.Status === 3 ? 'In Progress' : newTask.Status === 4 ? 'Completed' : 'Unknown'}<br>
                    <strong>Created Date:</strong> ${new Date(newTask.CreatedDate).toLocaleDateString()}<br>
                    <strong>Assigned Date:</strong> ${new Date(newTask.AssignedDate).toLocaleDateString()}
                `;

                await sendTaskAssignmentEmail(
                    newTask.AssignedToDetails.email,
                    newTask.Name,
                    taskDetails,
                    assignedBy,
                    newTask.Priority,
                    newTask.Status,
                    newTask.Type,
                    newTask.TaskID
                );
            } catch (emailError) {
                console.error('Error sending task assignment email:', emailError);
                // Don't fail the request if email fails
            }
        }

        try { await emitDashboardMetrics(taskData.OrganizationID || (await Project.findOne({ ProjectID: taskData.ProjectID_FK }))?.OrganizationID); } catch (e) {}
        res.status(201).json(newTask);
    } catch (err) {
        console.error('Error creating task:', err);
        // Log the error activity
        try {
            await logActivity(
                req.body.taskDetail?.CreatedBy,
                req.body.taskDetail?.Type === 'User Story' ? 'user_story_create' : 'task_create',
                'error',
                `Failed to create ${req.body.taskDetail?.Type?.toLowerCase() || 'task'}: ${err.message}`,
                req,
                {
                    taskName: req.body.taskDetail?.Name,
                    taskType: req.body.taskDetail?.Type,
                    error: err.message
                }
            );
        } catch (logError) {
            console.error('Failed to log error activity:', logError);
        }
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// GET /api/task-details - Get all tasks
router.get('/', async (req, res) => {
    try {
        const tasks = await TaskDetails.find().sort({ CreatedDate: 1 });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// GET /api/task-details/all - Get all tasks with user details for query board (filtered by organization)
router.get('/all', async (req, res) => {
    try {
        const { organizationId } = req.query;
        
        if (!organizationId) {
            return res.status(400).json({ error: 'Organization ID is required' });
        }

        // First, get all projects for the organization
        const projects = await Project.find({ OrganizationID: organizationId }).select('ProjectID');
        const projectIds = projects.map(project => project.ProjectID);

        if (projectIds.length === 0) {
            return res.json({ tasks: [], commonTypes: {} });
        }

        // Get tasks for projects in the organization
        const tasks = await TaskDetails.find({ 
            ProjectID_FK: { $in: projectIds }, 
            IsActive: true,
            Type: { $ne: "User Story" }
        }).sort({ CreatedDate: -1 });

        // Fetch CommonTypes for dropdowns
        const CommonType = require('../models/CommonType');
        const [taskStatuses, taskPriorities, taskTypes] = await Promise.all([
            CommonType.find({ MasterType: 'ProjectStatus' }).sort({ Code: 1 }),
            CommonType.find({ MasterType: 'PriorityType' }).sort({ Code: 1 }),
            CommonType.find({ MasterType: 'TaskType' }).sort({ Code: 1 })
        ]);

        // Use Promise.all to properly wait for all user details to be fetched
        const tasksWithDetails = await Promise.all(tasks.map(async (task) => {
            const newTask = task.toObject();

            // Fetch assignee details if exists
            if (newTask.Assignee) {
                try {
                    const assignee = await User.findById(task.Assignee);
                    if (assignee) {
                        const teamDetails = await TeamDetails.findOne({ MemberID: assignee._id });
                        let teamName = null;
                        if (teamDetails) {
                            const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                            teamName = team ? team.TeamName : null;
                        }
                        newTask.AssigneeDetails = {
                            _id: assignee._id,
                            username: assignee.username,
                            fullName: assignee.firstName + " " + assignee.lastName,
                            email: assignee.email,
                            teamName: teamName
                        };
                    }
                } catch (error) {
                    console.error('Error fetching assignee details:', error);
                }
            }

            // Fetch assignedTo details if exists
            if (newTask.AssignedTo) {
                try {
                    const assignedTo = await User.findById(task.AssignedTo);
                    if (assignedTo) {
                        const teamDetails = await TeamDetails.findOne({ MemberID: assignedTo._id });
                        let teamName = null;
                        if (teamDetails) {
                            const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                            teamName = team ? team.TeamName : null;
                        }
                        newTask.AssignedToDetails = {
                            _id: assignedTo._id,
                            username: assignedTo.username,
                            fullName: assignedTo.firstName + " " + assignedTo.lastName,
                            email: assignedTo.email,
                            teamName: teamName
                        };
                    }
                } catch (error) {
                    console.error('Error fetching assignedTo details:', error);
                }
            }

            return newTask;
        }));

        res.json({
            tasks: tasksWithDetails,
            commonTypes: {
                taskStatuses,
                taskPriorities,
                taskTypes
            }
        });
    } catch (error) {
        console.error('Error fetching all tasks:', error);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// GET /api/task-details/:taskId - Get a single task by ID
router.get('/:taskId', async (req, res) => {
    try {
        console.log(req.params);
        const taskId = req.params.taskId;
        const task = await TaskDetails.findOne({ TaskID: taskId, IsActive: true });

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const newTask = task.toObject();

        // Fetch assignee details if exists
        if (newTask.Assignee) {
            const assignee = await User.findById(task.Assignee);
            if (assignee) {
                const teamDetails = await TeamDetails.findOne({ MemberID: assignee._id });
                let teamName = null;
                if (teamDetails) {
                    const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                    teamName = team ? team.TeamName : null;
                }
                newTask.AssigneeDetails = {
                    _id: assignee._id,
                    username: assignee.username,
                    fullName: assignee.firstName + " " + assignee.lastName,
                    email: assignee.email,
                    teamName: teamName
                };
            }
        }

        // Fetch assignedTo details if exists
        if (newTask.AssignedTo) {
            const assignedTo = await User.findById(task.AssignedTo);
            if (assignedTo) {
                const teamDetails = await TeamDetails.findOne({ MemberID: assignedTo._id });
                let teamName = null;
                if (teamDetails) {
                    const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                    teamName = team ? team.TeamName : null;
                }
                newTask.AssignedToDetails = {
                    _id: assignedTo._id,
                    username: assignedTo.username,
                    fullName: assignedTo.firstName + " " + assignedTo.lastName,
                    email: assignedTo.email,
                    teamName: teamName
                };
            }
        }

        res.json(newTask);
    } catch (error) {
        console.error('Error fetching task:', error);
        res.status(500).json({ error: 'Failed to fetch task details' });
    }
});

// GET /api/task-details/project/:projectId - Get all tasks for a specific project
router.get('/project/:projectId', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const tasks = await TaskDetails.find({ ProjectID_FK: projectId, IsActive: true, Type: { $ne: "User Story" } }).sort({ CreatedDate: 1 });

        // Use Promise.all to properly wait for all user details to be fetched
        const newTaskList = await Promise.all(tasks.map(async (task) => {
            const newTask = task.toObject();

            // Fetch assignee details if exists
            if (newTask.Assignee) {
                const assignee = await User.findById(task.Assignee);
                if (assignee) {
                    const teamDetails = await TeamDetails.findOne({ MemberID: assignee._id });
                    let teamName = null;
                    if (teamDetails) {
                        const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                        teamName = team ? team.TeamName : null;
                    }
                    newTask.AssigneeDetails = {
                        _id: assignee._id,
                        username: assignee.username,
                        fullName: assignee.firstName + " " + assignee.lastName,
                        email: assignee.email,
                        teamName: teamName
                    };
                }
            }

            // Fetch assignedTo details if exists
            if (newTask.AssignedTo) {
                const assignedTo = await User.findById(task.AssignedTo);
                if (assignedTo) {
                    const teamDetails = await TeamDetails.findOne({ MemberID: assignedTo._id });
                    let teamName = null;
                    if (teamDetails) {
                        const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                        teamName = team ? team.TeamName : null;
                    }
                    newTask.AssignedToDetails = {
                        _id: assignedTo._id,
                        username: assignedTo.username,
                        fullName: assignedTo.firstName + " " + assignedTo.lastName,
                        email: assignedTo.email,
                        teamName: teamName
                    };
                }
            }

            // Get attachments and comments count
            const [attachmentsCount, commentsCount] = await Promise.all([
                Attachment.countDocuments({ TaskID: task.TaskID }),
                Comment.countDocuments({ TaskID: task.TaskID })
            ]);

            newTask.attachmentsCount = attachmentsCount;
            newTask.commentsCount = commentsCount;

            // Fetch active subtasks for this task (sorted by CreatedDate)
            try {
                const Subtask = require('../models/Subtask');
                const rawSubtasks = await Subtask.find({ TaskID_FK: task.TaskID, IsActive: true })
                    .sort({ IsCompleted: -1, CreatedDate: 1 })
                    .lean();

                // Optionally enrich with minimal creator/completer display data
                const populatedSubtasks = await Promise.all(rawSubtasks.map(async (s) => {
                    const subtask = { ...s };
                    if (s.CreatedBy) {
                        const u = await User.findById(s.CreatedBy).select('firstName lastName');
                        if (u) {
                            subtask.CreatedByDetails = {
                                _id: u._id,
                                fullName: `${u.firstName} ${u.lastName}`,
                            };
                        }
                    }
                    if (s.CompletedBy) {
                        const u2 = await User.findById(s.CompletedBy).select('firstName lastName');
                        if (u2) {
                            subtask.CompletedByDetails = {
                                _id: u2._id,
                                fullName: `${u2.firstName} ${u2.lastName}`,
                            };
                        }
                    }
                    return subtask;
                }));
                newTask.subtasks = populatedSubtasks;
            } catch (e) {
                newTask.subtasks = [];
            }

            return newTask;
        }));

        res.json(newTaskList);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Failed to fetch project tasks' });
    }
});

// GET /api/task-details/project/:projectId/team-members - Get all team members for a project
router.get('/project/:projectId/team-members', async (req, res) => {
    try {
        const projectId = req.params.projectId;

        // Find teams assigned to this project
        const projectDetails = await ProjectDetails.find({ ProjectID: projectId, IsActive: true });
        const teamIds = projectDetails.map(pd => pd.TeamID);

        // Find team members for these teams
        const teamMembers = await TeamDetails.find({ TeamID_FK: { $in: teamIds }, IsMemberActive: true });
        const memberIds = teamMembers.map(tm => tm.MemberID);

        // Fetch user details
        const users = await User.find({ _id: { $in: memberIds } });

        // Map users with their team info
        const membersWithTeamInfo = await Promise.all(users.map(async (user) => {
            const teamDetail = teamMembers.find(tm => tm.MemberID === user._id.toString());
            let teamInfo = null;

            if (teamDetail) {
                const team = await Team.findOne({ TeamID: teamDetail.TeamID_FK }).select('TeamName');
                teamInfo = team ? { teamId: team.TeamID, teamName: team.TeamName } : null;
            }

            return {
                _id: user._id,
                fullName: `${user.firstName} ${user.lastName}`,
                email: user.email,
                team: teamInfo
            };
        }));

        res.json(membersWithTeamInfo);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Failed to fetch team members' });
    }
});

// GET /api/task-details/project/:projectId/kanban - Minimal tasks + user stories for Kanban
router.get('/project/:projectId/kanban', async (req, res) => {
    try {
        const projectId = req.params.projectId;

        // Fetch non-User Story tasks (active)
        const tasks = await TaskDetails.find({ ProjectID_FK: projectId, IsActive: true, Type: { $ne: "User Story" } }).sort({ CreatedDate: 1 });

        const shapedTasks = await Promise.all(tasks.map(async (task) => {
            const shaped = task.toObject();

            // AssignedTo details (minimal)
            if (shaped.AssignedTo) {
                const user = await User.findById(task.AssignedTo).select('firstName lastName username email');
                if (user) {
                    shaped.AssignedToDetails = {
                        _id: user._id,
                        username: user.username,
                        fullName: `${user.firstName} ${user.lastName}`,
                        email: user.email
                    };
                }
            }

            // counts
            const [attachmentsCount, commentsCount] = await Promise.all([
                Attachment.countDocuments({ TaskID: task.TaskID }),
                Comment.countDocuments({ TaskID: task.TaskID })
            ]);
            shaped.attachmentsCount = attachmentsCount;
            shaped.commentsCount = commentsCount;

            // include active subtasks (minimal + creator/completer display)
            try {
                const Subtask = require('../models/Subtask');
                const raw = await Subtask.find({ TaskID_FK: task.TaskID, IsActive: true })
                    .sort({ IsCompleted: -1, CreatedDate: 1 })
                    .lean();
                shaped.subtasks = await Promise.all(raw.map(async (s) => {
                    const sub = { ...s };
                    if (s.CreatedBy) {
                        const u = await User.findById(s.CreatedBy).select('firstName lastName');
                        if (u) sub.CreatedByDetails = { _id: u._id, fullName: `${u.firstName} ${u.lastName}` };
                    }
                    if (s.CompletedBy) {
                        const u2 = await User.findById(s.CompletedBy).select('firstName lastName');
                        if (u2) sub.CompletedByDetails = { _id: u2._id, fullName: `${u2.firstName} ${u2.lastName}` };
                    }
                    return sub;
                }));
            } catch (e) {
                shaped.subtasks = [];
            }

            // keep only required fields implicitly by returning shaped
            return shaped;
        }));

        // Fetch user stories for the project (minimal)
        const userStoriesDocs = await TaskDetails.find({ ProjectID_FK: projectId, IsActive: true, Type: 'User Story' })
            .select('TaskID Name Status Priority CreatedDate')
            .sort({ CreatedDate: 1 })
            .lean();

        return res.json({ tasks: shapedTasks, userStories: userStoriesDocs });
    } catch (error) {
        console.error('Error fetching kanban data:', error);
        return res.status(500).json({ error: 'Failed to fetch kanban data' });
    }
});

// PATCH /api/task-details/:taskId/status - Update task status
router.patch('/:taskId/status', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { Status, modifiedBy } = req.body;

        const task = await TaskDetails.findOne({ TaskID: taskId });
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const oldStatus = task.Status;

        // Fetch status values from CommonType
        const [oldStatusType, newStatusType] = await Promise.all([
            CommonType.findOne({ MasterType: 'ProjectStatus', Code: oldStatus }),
            CommonType.findOne({ MasterType: 'ProjectStatus', Code: Status })
        ]);
        const oldStatusValue = oldStatusType ? oldStatusType.Value : oldStatus;
        const newStatusValue = newStatusType ? newStatusType.Value : Status;

        // Save task history before updating
        const taskHistory = new TaskDetailsHistory({
            TaskID: task.TaskID,
            ParentID: task.ParentID,
            Name: task.Name,
            Description: task.Description,
            OldStatus: task.Status,
            Type: task.Type,
            Old_Assignee: task.Assignee,
            Old_AssignedTo: task.AssignedTo,
            ProjectID_FK: task.ProjectID_FK,
            IsActive: task.IsActive,
            CreatedDate: task.CreatedDate,
            AssignedDate: task.AssignedDate,
            CreatedBy: task.CreatedBy,
            ModifiedDate: task.ModifiedDate,
            ModifiedBy: task.ModifiedBy,
            HistoryDate: new Date()
        });

        await taskHistory.save();

        // Update status
        task.Status = Status;
        task.ModifiedDate = new Date();
        task.ModifiedBy = modifiedBy;
        await task.save();

        // Log the activity (log status values, not codes)
        await logActivity(
            task.CreatedBy,
            task.Type == 'User Story' ? 'user_story_update' : 'task_update',
            'success',
            `Updated ${task.Type.toLowerCase()} "${task.Name}" status from ${oldStatusValue} to ${newStatusValue}`,
            req,
            {
                taskId: task.TaskID,
                taskName: task.Name,
                taskType: task.Type,
                oldStatus: oldStatusValue,
                newStatus: newStatusValue,
                projectId: task.ProjectID_FK
            }
        );

        try { await emitDashboardMetrics((await Project.findOne({ ProjectID: task.ProjectID_FK }))?.OrganizationID); } catch (e) {}
        try {
            emitToProject(task.ProjectID_FK, 'kanban.task.status.updated', {
                event: 'kanban.task.status.updated',
                version: 1,
                data: { projectId: task.ProjectID_FK, taskId: task.TaskID, status: task.Status },
                meta: { emittedAt: new Date().toISOString() }
            });
        } catch (e) {}
        // Emit to task room for task details viewers
        try {
            emitToTask(task.TaskID, 'task.updated', {
                event: 'task.updated',
                version: 1,
                data: { taskId: task.TaskID, changes: { Status: task.Status } },
                meta: { emittedAt: new Date().toISOString() }
            });
        } catch (e) {}
        res.json(task);
    } catch (error) {
        console.error('Error updating task status:', error);
        // Log the error activity
        try {
            const task = await TaskDetails.findOne({ TaskID: req.params.taskId });
            await logActivity(
                task?.CreatedBy,
                task.Type == 'User Story' ? 'user_story_update' : 'task_update',
                'error',
                `Failed to update task status: ${error.message}`,
                req,
                {
                    taskId: req.params.taskId,
                    error: error.message
                }
            );
        } catch (logError) {
            console.error('Failed to log error activity:', logError);
        }
        res.status(500).json({ error: 'Failed to update task status' });
    }
});

// PATCH /api/task-details/:taskId/assign - Assign a task to a user
router.patch('/:taskId/assign', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { AssignedTo, AssignedDate, assignedBy } = req.body;

        const task = await TaskDetails.findOne({ TaskID: taskId });
        if (!task) return res.status(404).json({ error: 'Task not found' });
        const oldStatus = task.Status;
        const oldAssignedTo = task.AssignedTo;

        // Save task history before updating
        const taskHistory = new TaskDetailsHistory({
            TaskID: task.TaskID,
            ParentID: task.ParentID,
            Name: task.Name,
            Description: task.Description,
            OldStatus: task.Status,
            Type: task.Type,
            Old_Assignee: task.Assignee,
            Old_AssignedTo: task.AssignedTo,
            ProjectID_FK: task.ProjectID_FK,
            IsActive: task.IsActive,
            CreatedDate: task.CreatedDate,
            AssignedDate: task.AssignedDate,
            CreatedBy: task.CreatedBy,
            HistoryDate: new Date()
        });

        await taskHistory.save();

        // Update assignment
        task.AssignedTo = AssignedTo;
        task.AssignedDate = AssignedTo ? (AssignedDate || new Date()) : null;

        // Update status based on assignment
        if (AssignedTo && task.Status === 1) {
            task.Status = 2; // Assigned status
        } else if (!AssignedTo && task.Status === 2) {
            task.Status = 1; // Back to Not Assigned status
        }

        await task.save();

        // Get assignee details to return with response
        let assignedToDetails = null;
        if (task.AssignedTo) {
            const assignedTo = await User.findById(task.AssignedTo);
            if (assignedTo) {
                const teamDetails = await TeamDetails.findOne({ MemberID: assignedTo._id });
                let teamName = null;
                if (teamDetails) {
                const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                    teamName = team ? team.TeamName : null;
                }
                assignedToDetails = {
                    _id: assignedTo._id,
                    username: assignedTo.username,
                    fullName: assignedTo.firstName + " " + assignedTo.lastName,
                    email: assignedTo.email,
                    teamName: teamName
                };
            }
        }

        const taskWithDetails = task.toObject();
        taskWithDetails.AssignedToDetails = assignedToDetails;

        // Log the activity
        const actionType = AssignedTo ? 'task_assign' : 'task_unassign';
        const actionDescription = AssignedTo ? 
            `Task "${task.Name}" assigned to user` : 
            `Task "${task.Name}" unassigned`;

        await logActivity(
            task.CreatedBy,
            actionType,
            'success',
            actionDescription,
            req,
            {
                taskId: task.TaskID,
                taskName: task.Name,
                oldAssignedTo,
                newAssignedTo: AssignedTo,
                projectId: task.ProjectID_FK
            }
        );

        // Log assignment activity and send email notification
        if (AssignedTo) {
            const assignedUser = await User.findById(AssignedTo);
            if (assignedUser) {
                // Get the user who is making the assignment (from request body)
                const assignedByUser = await User.findById(assignedBy);
                const assignedByName = assignedByUser ? `${assignedByUser.firstName} ${assignedByUser.lastName}` : 'Unknown User';

                await logActivity(
                    task.CreatedBy,
                    'task_assign',
                    'success',
                    `${assignedByName} assigned task "${task.Name}" to ${assignedUser.firstName} ${assignedUser.lastName}`,
                    req,
                    {
                        taskId: task.TaskID,
                        taskName: task.Name,
                        assignedTo: assignedUser._id,
                        assignedToName: `${assignedUser.firstName} ${assignedUser.lastName}`,
                        assignedBy: assignedBy,
                        assignedByName: assignedByName,
                        projectId: task.ProjectID_FK
                    }
                );

                // Send email notification to the assigned user
                try {
                    // Fetch project info
                    const project = await Project.findOne({ ProjectID: task.ProjectID_FK });
                    // Fetch last 5 history items
                    const historyItems = await TaskDetailsHistory.find({ TaskID: task.TaskID }).sort({ HistoryDate: -1 }).limit(3);
                    // Fetch up to 3 attachments
                    const attachments = await Attachment.find({ TaskID: task.TaskID }).sort({ UploadedAt: -1 }).limit(3);
                    // Fetch up to 3 comments
                    const comments = await Comment.find({ TaskID: task.TaskID }).sort({ CreatedAt: -1 }).limit(3);

                    const taskDetails = `
                        <strong>Task Name:</strong> ${task.Name}<br>
                        <strong>Description:</strong> ${task.Description || 'No description provided'}<br>
                        <strong>Type:</strong> ${task.Type}<br>
                        <strong>Priority:</strong> ${task.Priority || 'Not set'}<br>
                        <strong>Status:</strong> ${task.Status === 1 ? 'Not Assigned' : task.Status === 2 ? 'Assigned' : task.Status === 3 ? 'In Progress' : task.Status === 4 ? 'Completed' : 'Unknown'}<br>
                        <strong>Assigned Date:</strong> ${task.AssignedDate ? new Date(task.AssignedDate).toISOString() : ''}
                    `;

                    await sendTaskAssignmentEmail(
                        assignedUser.email,
                        task.Name,
                        taskDetails,
                        assignedByName,
                        task.Priority,
                        task.Status,
                        task.Type,
                        task.TaskID,
                        project,
                        historyItems,
                        attachments.length > 0 ? attachments : null,
                        comments.length > 0 ? comments : null
                    );
                } catch (emailError) {
                    console.error('Error sending task assignment email:', emailError);
                    // Don't fail the request if email fails
                }
            }
        }

        // Fetch updated task activity after assignment
        const taskActivity = await UserActivity.find({
            'metadata.taskId': task.TaskID
        }).sort({ timestamp: -1 }).limit(10);

        // Emit to task room so Task Details viewers update immediately
        try {
            emitToTask(task.TaskID, 'task.updated', {
                event: 'task.updated',
                version: 1,
                data: {
                    taskId: task.TaskID,
                    changes: {
                        AssignedTo: AssignedTo,
                        AssignedToDetails: assignedToDetails || null,
                        Status: task.Status,
                        AssignedDate: task.AssignedDate
                    }
                },
                meta: { emittedAt: new Date().toISOString() }
            });
        } catch (e) {}

        try {
            emitToProject(task.ProjectID_FK, 'kanban.task.assigned', {
                event: 'kanban.task.assigned',
                version: 1,
                data: { projectId: task.ProjectID_FK, taskId: task.TaskID, assignedTo: AssignedTo, status: task.Status },
                meta: { emittedAt: new Date().toISOString() }
            });
        } catch (e) {}
        try { await emitDashboardMetrics((await Project.findOne({ ProjectID: task.ProjectID_FK }))?.OrganizationID); } catch (e) {}
        res.json({
            ...taskWithDetails,
            taskActivity
        });
    } catch (error) {
        console.error('Error assigning task:', error);
        // Log the error activity
        try {
            const task = await TaskDetails.findOne({ TaskID: req.params.taskId });
            await logActivity(
                task?.CreatedBy,
                'task_assign',
                'error',
                `Failed to assign task: ${error.message}`,
                req,
                {
                    taskId: req.params.taskId,
                    error: error.message
                }
            );
        } catch (logError) {
            console.error('Failed to log error activity:', logError);
        }
        res.status(500).json({ error: 'Failed to assign task' });
    }
});

// GET /api/task-details/:taskId/activity - Get task activity with pagination
router.get('/:taskId/activity', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const [activity, total] = await Promise.all([
            UserActivity.find({ 'metadata.taskId': taskId })
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            UserActivity.countDocuments({ 'metadata.taskId': taskId })
        ]);

        res.json({
            activity,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Error fetching task activity:', error);
        res.status(500).json({ error: 'Failed to fetch task activity' });
    }
});

// DELETE /api/task-details/:taskId/delete - Delete a task
router.delete('/:taskId/delete', async (req, res) => {
    try {
        const taskId = req.params.taskId;

        const task = await TaskDetails.findOne({ TaskID: taskId });
        if (!task) return res.status(404).json({ error: 'Task not found' });

        // Save task history before deleting
        const taskHistory = new TaskDetailsHistory({
            TaskID: task.TaskID,
            ParentID: task.ParentID,
            Name: task.Name,
            Description: task.Description,
            OldStatus: task.Status,
            Type: task.Type,
            Old_Assignee: task.Assignee,
            Old_AssignedTo: task.AssignedTo,
            ProjectID_FK: task.ProjectID_FK,
            IsActive: task.IsActive,
            CreatedDate: task.CreatedDate,
            AssignedDate: task.AssignedDate,
            CreatedBy: task.CreatedBy,
            HistoryDate: new Date()
        });

        await taskHistory.save();

        // Log the activity before deleting
        await logActivity(
            task.CreatedBy,
            task.Type == 'User Story' ? 'user_story_delete' : 'task_delete',
            'success',
            `Deleted ${task.Type.toLowerCase()} "${task.Name}"`,
            req,
            {
                taskId: task.TaskID,
                taskName: task.Name,
                taskType: task.Type,
                projectId: task.ProjectID_FK,
                status: task.Status
            }
        );

        // Hard delete the task
        await task.deleteOne();

        try {
            emitToProject(task.ProjectID_FK, 'kanban.task.deleted', {
                event: 'kanban.task.deleted',
                version: 1,
                data: { projectId: task.ProjectID_FK, taskId: task.TaskID },
                meta: { emittedAt: new Date().toISOString() }
            });
        } catch (e) {}
        try { await emitDashboardMetrics((await Project.findOne({ ProjectID: task.ProjectID_FK }))?.OrganizationID); } catch (e) {}
        res.json({ success: true, message: 'Task Deleted Successfully' });
    } catch (error) {
        console.error('Error deleting task:', error);
        // Log the error activity
        try {
            const task = await TaskDetails.findOne({ TaskID: req.params.taskId });
            await logActivity(
                task?.CreatedBy,
                task.Type == 'User Story' ? 'user_story_delete' : 'task_delete',
                'error',
                `Failed to delete task: ${error.message}`,
                req,
                {
                    taskId: req.params.taskId,
                    error: error.message
                }
            );
        } catch (logError) {
            console.error('Failed to log error activity:', logError);
        }
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// PATCH /api/task-details/:taskId - Update task details
router.patch('/:taskId', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const updateData = req.body;

        const task = await TaskDetails.findOne({ TaskID: taskId });
        if (!task) return res.status(404).json({ error: 'Task not found' });

        // Save task history before updating
        const taskHistory = new TaskDetailsHistory({
            TaskID: task.TaskID,
            ParentID: task.ParentID,
            Name: task.Name,
            Description: task.Description,
            OldStatus: task.Status,
            Type: task.Type,
            Priority: task.Priority,
            Old_Assignee: task.Assignee,
            Old_AssignedTo: task.AssignedTo,
            ProjectID_FK: task.ProjectID_FK,
            IsActive: task.IsActive,
            CreatedDate: task.CreatedDate,
            AssignedDate: task.AssignedDate,
            CreatedBy: task.CreatedBy,
            HistoryDate: new Date()
        });

        await taskHistory.save();

        // Update task fields
        if (updateData.Name !== undefined) task.Name = updateData.Name;
        if (updateData.Description !== undefined) task.Description = updateData.Description;
        if (updateData.Type !== undefined) task.Type = updateData.Type;
        if (updateData.Priority !== undefined) task.Priority = updateData.Priority;
        if (updateData.ParentID !== undefined) task.ParentID = updateData.ParentID;
        if (updateData.IsActive !== undefined) task.IsActive = updateData.IsActive;

        await task.save();

        const updatedTask = task.toObject();

        // Fetch assignee details if exists
        if (updatedTask.Assignee) {
            const assignee = await User.findById(updatedTask.Assignee);
            if (assignee) {
                const teamDetails = await TeamDetails.findOne({ MemberID: assignee._id });
                let teamName = null;
                if (teamDetails) {
                    const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                    teamName = team ? team.TeamName : null;
                }
                updatedTask.AssigneeDetails = {
                    _id: assignee._id,
                    username: assignee.username,
                    fullName: assignee.firstName + " " + assignee.lastName,
                    email: assignee.email,
                    teamName: teamName
                };
            }
        }

        // Fetch assignedTo details if exists
        if (updatedTask.AssignedTo) {
            const assignedTo = await User.findById(updatedTask.AssignedTo);
            if (assignedTo) {
                const teamDetails = await TeamDetails.findOne({ MemberID: assignedTo._id });
                let teamName = null;
                if (teamDetails) {
                    const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                    teamName = team ? team.TeamName : null;
                }
                updatedTask.AssignedToDetails = {
                    _id: assignedTo._id,
                    username: assignedTo.username,
                    fullName: assignedTo.firstName + " " + assignedTo.lastName,
                    email: assignedTo.email,
                    teamName: teamName
                };
            }
        }

        // Log the activity
        await logActivity(
            task.CreatedBy,
            task.Type === 'User Story' ? 'user_story_update' : 'task_update',
            'success',
            `Updated ${task.Type.toLowerCase()} "${task.Name}"`,
            req,
            {
                taskId: task.TaskID,
                taskName: task.Name,
                taskType: task.Type,
                projectId: task.ProjectID_FK,
                status: task.Status
            }
        );

        try { await emitDashboardMetrics((await Project.findOne({ ProjectID: task.ProjectID_FK }))?.OrganizationID); } catch (e) {}
        // Emit task field updates to project and task rooms
        try {
            emitToProject(task.ProjectID_FK, 'kanban.task.updated', {
                event: 'kanban.task.updated',
                version: 1,
                data: { projectId: task.ProjectID_FK, task: updatedTask },
                meta: { emittedAt: new Date().toISOString() }
            });
            emitToTask(task.TaskID, 'task.updated', {
                event: 'task.updated',
                version: 1,
                data: { taskId: task.TaskID, changes: updatedTask },
                meta: { emittedAt: new Date().toISOString() }
            });
        } catch (e) {}
        res.json(updatedTask);
    } catch (error) {
        console.error('Error updating task:', error);
        // Log the error activity
        try {
            const task = await TaskDetails.findOne({ TaskID: req.params.taskId });
            await logActivity(
                task?.CreatedBy,
                task.Type === 'User Story' ? 'user_story_update' : 'task_update',
                'error',
                `Failed to update task: ${error.message}`,
                req,
                {
                    taskId: req.params.taskId,
                    error: error.message
                }
            );
        } catch (logError) {
            console.error('Failed to log error activity:', logError);
        }
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// DELETE /api/task-details/bulk-delete - Delete multiple tasks
router.delete('/bulk-delete', async (req, res) => {
    try {
        const { taskIds } = req.body;
        if (!Array.isArray(taskIds) || taskIds.length === 0) {
            return res.status(400).json({ error: 'Task IDs array is required' });
        }

        // Find all tasks to be deleted
        const tasksToDelete = await TaskDetails.find({ TaskID: { $in: taskIds } });
        if (tasksToDelete.length === 0) {
            return res.status(404).json({ error: 'No tasks found to delete' });
        }

        // Save task history for all tasks before deleting
        const taskHistories = tasksToDelete.map(task => new TaskDetailsHistory({
            TaskID: task.TaskID,
            ParentID: task.ParentID,
            Name: task.Name,
            Description: task.Description,
            OldStatus: task.Status,
            Type: task.Type,
            Priority: task.Priority,
            Old_Assignee: task.Assignee,
            Old_AssignedTo: task.AssignedTo,
            ProjectID_FK: task.ProjectID_FK,
            IsActive: task.IsActive,
            CreatedDate: task.CreatedDate,
            AssignedDate: task.AssignedDate,
            CreatedBy: task.CreatedBy,
            HistoryDate: new Date()
        }));

        await TaskDetailsHistory.insertMany(taskHistories);

        // Log activities for each task
        for (const task of tasksToDelete) {
            await logActivity(
                task.CreatedBy,
                task.Type === 'User Story' ? 'user_story_delete' : 'task_delete',
                'success',
                `Deleted ${task.Type.toLowerCase()} "${task.Name}"`,
                req,
                {
                    taskId: task.TaskID,
                    taskName: task.Name,
                    taskType: task.Type,
                    projectId: task.ProjectID_FK,
                    status: task.Status
                }
            );
        }

        // Delete all tasks
        const result = await TaskDetails.deleteMany({ TaskID: { $in: taskIds } });

        res.json({
            success: true,
            message: `Successfully deleted ${result.deletedCount} tasks`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('Error deleting tasks:', error);
        // Log the error activity
        try {
            await logActivity(
                req.body.CreatedBy || 'unknown',
                'task_bulk_delete',
                'error',
                `Failed to delete tasks: ${error.message}`,
                req,
                {
                    taskIds: req.body.taskIds,
                    error: error.message
                }
            );
        } catch (logError) {
            console.error('Failed to log error activity:', logError);
        }
        res.status(500).json({ error: 'Failed to delete tasks' });
    }
});

// GET /api/task-details/:taskId/full - Get task with subtasks, attachments, comments
router.get('/:taskId/full', async (req, res) => {
    try {
        const { taskId } = req.params;

        const task = await TaskDetails.findOne({ TaskID: taskId, IsActive: true });
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const newTask = task.toObject();

        // Fetch assignee details if exists
        if (newTask.Assignee) {
            const assignee = await User.findById(newTask.Assignee);
            if (assignee) {
                const teamDetails = await TeamDetails.findOne({ MemberID: assignee._id });
                let teamName = null;
                if (teamDetails) {
                    const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                    teamName = team ? team.TeamName : null;
                }
                newTask.AssigneeDetails = {
                    _id: assignee._id,
                    username: assignee.username,
                    fullName: assignee.firstName + " " + assignee.lastName,
                    email: assignee.email,
                    teamName: teamName
                };
            }
        }

        // Fetch assignedTo details if exists
        if (newTask.AssignedTo) {
            const assignedTo = await User.findById(newTask.AssignedTo);
            if (assignedTo) {
                const teamDetails = await TeamDetails.findOne({ MemberID: assignedTo._id });
                let teamName = null;
                if (teamDetails) {
                    const team = await Team.findOne({ TeamID: teamDetails.TeamID_FK }).select('TeamName');
                    teamName = team ? team.TeamName : null;
                }
                newTask.AssignedToDetails = {
                    _id: assignedTo._id,
                    username: assignedTo.username,
                    fullName: assignedTo.firstName + " " + assignedTo.lastName,
                    email: assignedTo.email,
                    teamName: teamName
                };
            }
        }

        // Fetch project details if task has a ProjectID_FK
        let project = null;
        let projectMembers = [];
        if (newTask.ProjectID_FK) {
            try {
                project = await Project.findOne({ ProjectID: newTask.ProjectID_FK });

                // Fetch project members
                if (project) {
                    // Get teams assigned to this project through ProjectDetails
                    const projectDetails = await ProjectDetails.find({ ProjectID: project.ProjectID, IsActive: true });

                    if (projectDetails.length > 0) {
                        const teamIds = projectDetails.map(pd => pd.TeamID);

                        // Get team members for these teams
                        const teamMembers = await TeamDetails.find({ TeamID_FK: { $in: teamIds }, IsMemberActive: true });

                        if (teamMembers.length > 0) {
                            const memberIds = teamMembers.map(tm => tm.MemberID);
                            const members = await User.find({ _id: { $in: memberIds } });
                            projectMembers = members.map(member => ({
                                _id: member._id,
                                username: member.username,
                                fullName: member.firstName + " " + member.lastName,
                                email: member.email
                            }));
                        }
                    }
                }
            } catch (projectError) {
                console.error('Error fetching project details:', projectError);
            }
        }

        const attachments = await Attachment.find({ TaskID: taskId }).sort({ UploadedAt: -1 });
        const comments = await Comment.find({ TaskID: taskId }).sort({ CreatedAt: 1 });

        // Fetch subtasks
        const subtasks = await Subtask.find({ 
            TaskID_FK: taskId, 
            IsActive: true 
        }).sort({ Order: 1, CreatedDate: 1 });

        // Populate user details for subtasks
        const populatedSubtasks = await Promise.all(
            subtasks.map(async (subtask) => {
                const subtaskObj = subtask.toObject();
                
                if (subtask.CreatedBy) {
                    const createdByUser = await User.findById(subtask.CreatedBy).select('firstName lastName');
                    if (createdByUser) {
                        subtaskObj.CreatedByDetails = {
                            _id: createdByUser._id,
                            fullName: `${createdByUser.firstName} ${createdByUser.lastName}`,
                        };
                    }
                }
                
                if (subtask.CompletedBy) {
                    const completedByUser = await User.findById(subtask.CompletedBy).select('firstName lastName');
                    if (completedByUser) {
                        subtaskObj.CompletedByDetails = {
                            _id: completedByUser._id,
                            fullName: `${completedByUser.firstName} ${completedByUser.lastName}`,
                        };
                    }
                }
                
                return subtaskObj;
            })
        );

        // Fetch task activity
        const taskActivity = await UserActivity.find({
            'metadata.taskId': taskId
        }).sort({ timestamp: -1 }).limit(10);

        let userStoryTasks = [];
        if (newTask.Type === 'User Story') {
            userStoryTasks = await TaskDetails.find({ ParentID: newTask.TaskID, IsActive: true });
        }

        res.json({
            task: newTask,
            project,
            projectMembers,
            subtasks: populatedSubtasks,
            attachments,
            comments,
            taskActivity,
            userStoryTasks
        });
    } catch (err) {
        console.error('Error fetching full task details:', err);
        res.status(500).json({ error: 'Failed to fetch full task details' });
    }
});

module.exports = router; 