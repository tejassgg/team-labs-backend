const mongoose = require('mongoose');
const dotenv = require('dotenv');
const CommonType = require('../models/CommonType');

dotenv.config();
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const teamTypes = [
  { Value: 'Development', Code: 1, MasterType: 'TeamType' },
  { Value: 'Quality Analysis', Code: 2, MasterType: 'TeamType' },
  { Value: 'Code Verification', Code: 3, MasterType: 'TeamType' },
  { Value: 'Deployment', Code: 4, MasterType: 'TeamType' },
  { Value: 'Service Integration', Code: 5, MasterType: 'TeamType' },
  { Value: 'InHouse', Code: 6, MasterType: 'TeamType' }
];

(async () => {
  await CommonType.deleteMany({ MasterType: 'TeamType' });
  await CommonType.insertMany(teamTypes);
  console.log('Seeded TeamType options!');
  mongoose.disconnect();
})();