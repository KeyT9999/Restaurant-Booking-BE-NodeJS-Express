const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();
const WithdrawalRequest = require('./src/models/WithdrawalRequest');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const result = await WithdrawalRequest.updateMany(
    { proofImage: { $regex: 'wikipedia', $options: 'i' } },
    { $set: { proofImage: 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg' } }
  );
  console.log('Updated', result.modifiedCount, 'records with bad Wikipedia URLs');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
