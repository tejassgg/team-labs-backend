const mongoose = require('mongoose');
const dotenv = require('dotenv');
const CommonType = require('../models/CommonType');

dotenv.config();
mongoose.connect(process.env.MONGO_URI);

const phoneExtensions = [
  { Code: 1,Value: '+1', Description: 'US/Canada', MasterType: 'PhoneExtension' },
  { Code: 2,Value: '+44', Description: 'UK', MasterType: 'PhoneExtension' },
  { Code: 3,Value: '+91', Description: 'India', MasterType: 'PhoneExtension' },
  { Code: 4,Value: '+61', Description: 'Australia', MasterType: 'PhoneExtension' },
  { Code: 5,Value: '+86', Description: 'China', MasterType: 'PhoneExtension' },
  { Code: 6,Value: '+81', Description: 'Japan', MasterType: 'PhoneExtension' },
  { Code: 7,Value: '+49', Description: 'Germany', MasterType: 'PhoneExtension' },
  { Code: 8,Value: '+33', Description: 'France', MasterType: 'PhoneExtension' },
  { Code: 9,Value: '+39', Description: 'Italy', MasterType: 'PhoneExtension' },
  { Code: 10,Value: '+34', Description: 'Spain', MasterType: 'PhoneExtension' },
  { Code: 11,Value: '+55', Description: 'Brazil', MasterType: 'PhoneExtension' },
  { Code: 12,Value: '+52', Description: 'Mexico', MasterType: 'PhoneExtension' },
  { Code: 13,Value: '+27', Description: 'South Africa', MasterType: 'PhoneExtension' },
  { Code: 14,Value: '+971', Description: 'UAE', MasterType: 'PhoneExtension' },
  { Code: 15,Value: '+65', Description: 'Singapore', MasterType: 'PhoneExtension' },
  { Code: 16,Value: '+82', Description: 'South Korea', MasterType: 'PhoneExtension' },
  { Code: 17,Value: '+31', Description: 'Netherlands', MasterType: 'PhoneExtension' },
  { Code: 18,Value: '+46', Description: 'Sweden', MasterType: 'PhoneExtension' },
  { Code: 19,Value: '+41', Description: 'Switzerland', MasterType: 'PhoneExtension' },
  { Code: 20,Value: '+32', Description: 'Belgium', MasterType: 'PhoneExtension' },
  { Code: 21,Value: '+43', Description: 'Austria', MasterType: 'PhoneExtension' },
  { Code: 22,Value: '+45', Description: 'Denmark', MasterType: 'PhoneExtension' },
  { Code: 23,Value: '+47', Description: 'Norway', MasterType: 'PhoneExtension' },
  { Code: 24,Value: '+358', Description: 'Finland', MasterType: 'PhoneExtension' },
  { Code: 25,Value: '+351', Description: 'Portugal', MasterType: 'PhoneExtension' },
  { Code: 26,Value: '+30', Description: 'Greece', MasterType: 'PhoneExtension' },
  { Code: 27,Value: '+36', Description: 'Hungary', MasterType: 'PhoneExtension' },
  { Code: 28,Value: '+48', Description: 'Poland', MasterType: 'PhoneExtension' },
  { Code: 29,Value: '+420', Description: 'Czech Republic', MasterType: 'PhoneExtension' },
  { Code: 30,Value: '+421', Description: 'Slovakia', MasterType: 'PhoneExtension' }
];

(async () => {
  await CommonType.deleteMany({ MasterType: 'PhoneExtension' });
  await CommonType.insertMany(phoneExtensions);
  console.log('Seeded PhoneExtension options!');
  mongoose.disconnect();
})();