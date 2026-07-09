const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });

async function createAdmin() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error('Khong tim thay MONGO_URI trong .env');
      process.exit(1);
    }
    
    console.log('Dang ket noi MongoDB...');
    await mongoose.connect(uri);
    console.log('Ket noi thanh cong!');

    // Load đúng model thực tế của project
    const User = require('./src/models/User');

    const email    = 'admin@bookeat.com';
    const username = 'admin_bookeat';
    const password = 'Admin@123456';

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    
    if (existing) {
      console.log('Da tim thay user, dang cap nhat role -> admin...');
      existing.role = 'admin';
      existing.active = true;
      existing.emailVerified = true;
      existing.password = password; // pre-save hook sẽ hash lại
      await existing.save();
      console.log('----------------------------------');
      console.log('Cap nhat thanh cong!');
      console.log('Email   :', existing.email);
      console.log('Username:', existing.username);
      console.log('Password: Admin@123456');
      console.log('Role    :', existing.role);
      console.log('----------------------------------');
    } else {
      console.log('Chua co admin, dang tao moi...');
      const admin = await User.create({
        username,
        email,
        password,
        fullName: 'Super Admin',
        role: 'admin',
        emailVerified: true,
        active: true,
      });
      console.log('----------------------------------');
      console.log('Tao admin thanh cong!');
      console.log('Email   :', admin.email);
      console.log('Username:', admin.username);
      console.log('Password: Admin@123456');
      console.log('Role    :', admin.role);
      console.log('----------------------------------');
    }

  } catch (error) {
    console.error('Loi:', error.message);
    if (error.errors) {
      Object.keys(error.errors).forEach(k => {
        console.error(' -', k, ':', error.errors[k].message);
      });
    }
  } finally {
    await mongoose.disconnect();
    console.log('Da ngat ket noi MongoDB.');
  }
}

createAdmin();
