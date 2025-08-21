const mongoose = require('mongoose');
const dotenv = require('dotenv');
const CommonType = require('../models/CommonType');

dotenv.config();
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const taskTypes = [
  { Value: 'Task', Code: 1, MasterType: 'TaskType' },
  { Value: 'Bug', Code: 2, MasterType: 'TaskType' },
  { Value: 'Feature', Code: 3, MasterType: 'TaskType' },
  { Value: 'Improvement', Code: 4, MasterType: 'TaskType' },
  { Value: 'User Story', Code: 5, MasterType: 'TaskType' },
  { Value: 'Documentation', Code: 6, MasterType: 'TaskType' },
  { Value: 'Maintenance', Code: 7, MasterType: 'TaskType' }
];

(async () => {
  await CommonType.deleteMany({ MasterType: 'TaskType' });
  await CommonType.insertMany(taskTypes);
  console.log('Seeded TaskType options!');
  mongoose.disconnect();
})();