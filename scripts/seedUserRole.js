const mongoose = require('mongoose');
const dotenv = require('dotenv');
const CommonType = require('../models/CommonType');

dotenv.config();
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const orgTypes = [
  { Value: 'Admin', Code: 1, MasterType: 'UserRole' },
  { Value: 'User', Code: 2, MasterType: 'UserRole' },
  { Value: 'Developer', Code: 3, MasterType: 'UserRole' },
  { Value: 'Tester', Code: 4, MasterType: 'UserRole' },
  { Value: 'Support Engineer', Code: 5, MasterType: 'UserRole' },
  { Value: 'Deployment Engineer', Code: 6, MasterType: 'UserRole' },
  { Value: 'Project Manager', Code: 7, MasterType: 'UserRole' },
  { Value: 'Client', Code: 8, MasterType: 'UserRole' },
];

(async () => {
  await CommonType.deleteMany({ MasterType: 'UserRole' });
  await CommonType.insertMany(orgTypes);
  console.log('Seeded UserRole options!');
  mongoose.disconnect();
})();