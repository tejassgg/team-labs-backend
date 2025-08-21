const express = require('express');
const router = express.Router();
const Subtask = require('../models/Subtask');
const TaskDetails = require('../models/TaskDetails');
const { emitToTask, emitToProject } = require('../socket');

// Get all subtasks for a task
router.get('/tasks/:taskId/subtasks', async (req, res) => {
  try {
    const { taskId } = req.params;
    const subtasks = await Subtask.find({ TaskID: taskId }).sort({ Order: 1, CreatedDate: 1 });
    res.json(subtasks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subtasks' });
  }
});

// Create a new subtask for a task
router.post('/tasks/:taskId/subtasks', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { Title, Order } = req.body;
    const subtask = new Subtask({ TaskID: taskId, Title, Order });
    await subtask.save();
    try {
      const task = await TaskDetails.findOne({ TaskID: taskId });
      if (task) emitToProject(task.ProjectID_FK, 'task.subtask.created', { event: 'task.subtask.created', version: 1, data: { taskId, subtask }, meta: { emittedAt: new Date().toISOString() } });
      emitToTask(taskId, 'task.subtask.created', { event: 'task.subtask.created', version: 1, data: { taskId, subtask }, meta: { emittedAt: new Date().toISOString() } });
    } catch (e) {}
    res.status(201).json(subtask);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create subtask' });
  }
});

// Update a subtask
router.patch('/subtasks/:subtaskId', async (req, res) => {
  try {
    const { subtaskId } = req.params;
    const update = req.body;
    const subtask = await Subtask.findOneAndUpdate({ SubtaskID: subtaskId }, update, { new: true });
    if (!subtask) return res.status(404).json({ error: 'Subtask not found' });
    try { emitToTask(subtask.TaskID, 'task.subtask.updated', { event: 'task.subtask.updated', version: 1, data: { taskId: subtask.TaskID, subtask }, meta: { emittedAt: new Date().toISOString() } }); } catch (e) {}
    res.json(subtask);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update subtask' });
  }
});

// Delete a subtask
router.delete('/subtasks/:subtaskId', async (req, res) => {
  try {
    const { subtaskId } = req.params;
    const result = await Subtask.findOneAndDelete({ SubtaskID: subtaskId });
    if (!result) return res.status(404).json({ error: 'Subtask not found' });
    try { emitToTask(result.TaskID, 'task.subtask.deleted', { event: 'task.subtask.deleted', version: 1, data: { taskId: result.TaskID, subtaskId }, meta: { emittedAt: new Date().toISOString() } }); } catch (e) {}
    res.json({ message: 'Subtask deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete subtask' });
  }
});

module.exports = router; 