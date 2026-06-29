require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  
  const newPass = 'bookeat123';
  const hash = await bcrypt.hash(newPass, 12);
  
  const result = await db.collection('users').updateOne(
    { _id: new mongoose.Types.ObjectId('6a11001ee818b2dd1a8767d3') },
    { $set: { password: hash } }
  );
  
  if (result.modifiedCount > 0) {
    console.log('✅ Da set password moi: ' + newPass);
  } else {
    console.log('Khong tim thay user');
  }
  
  await mongoose.disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
