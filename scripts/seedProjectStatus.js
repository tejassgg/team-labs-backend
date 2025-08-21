const mongoose = require('mongoose');
const dotenv = require('dotenv');
const CommonType = require('../models/CommonType');

dotenv.config();
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const ProjectStatuses = [
  { Value: 'Not Assigned', Code: 1, MasterType: 'ProjectStatus' },
  { Value: 'Assigned', Code: 2, MasterType: 'ProjectStatus' },
  { Value: 'In Progress', Code: 3, MasterType: 'ProjectStatus' },
  { Value: 'QA', Code: 4, MasterType: 'ProjectStatus' },
  { Value: 'Deployment', Code: 5, MasterType: 'ProjectStatus' },
  { Value: 'Completed', Code: 6, MasterType: 'ProjectStatus' }
];

(async () => {
  await CommonType.deleteMany({ MasterType: 'ProjectStatus' });
  await CommonType.insertMany(ProjectStatuses);
  console.log('Seeded ProjectStatus options!');
  mongoose.disconnect();
})();