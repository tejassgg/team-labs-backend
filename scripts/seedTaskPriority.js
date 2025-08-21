const mongoose = require('mongoose');
const dotenv = require('dotenv');
const CommonType = require('../models/CommonType');

dotenv.config();
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const PriorityTypes = [
  { Value: 'Low', Code: 1, MasterType: 'PriorityType' },
  { Value: 'Medium', Code: 2, MasterType: 'PriorityType' },
  { Value: 'High', Code: 3, MasterType: 'PriorityType' },
];

(async () => {
  await CommonType.deleteMany({ MasterType: 'PriorityType' });
  await CommonType.insertMany(PriorityTypes);
  console.log('Seeded PriorityType options!');
  mongoose.disconnect();
})();