const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Organization = require('../models/Organization');

dotenv.config();
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const dummyOwnerId = new mongoose.Types.ObjectId('681d488bb30030619cf0053d');
const dummyModifierId = new mongoose.Types.ObjectId('681d488bb30030619cf0053d');

const orgs = [
  { Name: 'Olanthroxx', OrganizationID: 1, OwnerID: dummyOwnerId, IsActive: true, CreatedDate: new Date(), ModifiedDate: new Date(), ModifiedBy: dummyModifierId },
  { Name: 'CoolStraxx', OrganizationID: 2, OwnerID: dummyOwnerId, IsActive: true, CreatedDate: new Date(), ModifiedDate: new Date(), ModifiedBy: dummyModifierId },
  { Name: 'Persistent Systems Limited', OrganizationID: 3, OwnerID: dummyOwnerId, IsActive: true, CreatedDate: new Date(), ModifiedDate: new Date(), ModifiedBy: dummyModifierId },
];

(async () => {
  await Organization.deleteMany({});
  await Organization.insertMany(orgs);
  console.log('Seeded Organization collection!');
  mongoose.disconnect();
})();