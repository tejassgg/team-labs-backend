const mongoose = require('mongoose');
const CommonType = require('../models/CommonType');

const TaskStatuses = [
  { Value: 'Not Assigned', Code: 1, MasterType: 'TaskStatus' },
  { Value: 'Assigned', Code: 2, MasterType: 'TaskStatus' },
  { Value: 'In Progress', Code: 3, MasterType: 'TaskStatus' },
  { Value: 'QA', Code: 4, MasterType: 'TaskStatus' },
  { Value: 'Deployment', Code: 5, MasterType: 'TaskStatus' },
  { Value: 'Completed', Code: 6, MasterType: 'TaskStatus' }
];

const seedTaskStatus = async () => {
  try {
    await CommonType.deleteMany({ MasterType: 'TaskStatus' });
    await CommonType.insertMany(TaskStatuses);
    console.log('Seeded TaskStatus options!');
  } catch (error) {
    console.error('Error seeding TaskStatus:', error);
  }
};

module.exports = seedTaskStatus; 