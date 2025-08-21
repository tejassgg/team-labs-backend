const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  Name: { type: String, required: true },
  OwnerID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  CreatedDate: { type: Date, default: Date.now },
  OrganizationID: { type: Number, required: true, unique: true },
  IsActive: { type: Boolean, default: true },
  ModifiedDate: { type: Date },
  ModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  usageLimits: {
    projectsCreated: { type: Number, default: 0 },
    tasksCreated: { type: Number, default: 0 },
    userStoriesCreated: { type: Number, default: 0 },
    teamsCreated: { type: Number, default: 0 }
  },
  isPremium: { type: Boolean, default: false },
  subscription: {
    plan: { type: String, default: 'free' },
    startDate: { type: Date },
    endDate: { type: Date }
  }
});

organizationSchema.methods.incrementUsage = async function(type) {
  if (type === 'project') this.usageLimits.projectsCreated++;
  if (type === 'task') this.usageLimits.tasksCreated++;
  if (type === 'userStory') this.usageLimits.userStoriesCreated++;
  if (type === 'team') this.usageLimits.teamsCreated++;
  await this.save();
};

module.exports = mongoose.model('Organization', organizationSchema); 