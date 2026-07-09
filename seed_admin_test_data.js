require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Restaurant = require('./src/models/Restaurant');
const Payment = require('./src/models/Payment');
const Refund = require('./src/models/Refund');
const WithdrawalRequest = require('./src/models/WithdrawalRequest');

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    // Find an owner
    const owner = await User.findOne({ role: 'restaurant_owner' });
    if (!owner) throw new Error('No restaurant owner found');

    // Find a restaurant
    const restaurant = await Restaurant.findOne({ ownerId: owner._id });
    if (!restaurant) throw new Error('No restaurant found');

    // Find or create a payment
    let payment = await Payment.findOne({});
    if (!payment) {
      payment = await Payment.create({
        userId: owner._id,
        amount: 500000,
        currency: 'VND',
        status: 'completed',
        paymentMethod: 'credit_card',
        paymentType: 'booking_deposit',
      });
    }

    console.log('Found owner:', owner.email);
    console.log('Found restaurant:', restaurant.name);

    // Create 3 Refunds
    await Refund.create([
      {
        paymentId: payment._id,
        requestedBy: owner._id,
        requestedByRole: 'restaurant_owner',
        amount: 50000,
        reason: 'Khách hàng hủy bàn, hoàn lại tiền cọc',
        status: 'requested'
      },
      {
        paymentId: payment._id,
        requestedBy: owner._id,
        requestedByRole: 'restaurant_owner',
        amount: 120000,
        reason: 'Hệ thống lỗi trừ đúp tiền',
        status: 'requested'
      },
      {
        paymentId: payment._id,
        requestedBy: owner._id,
        requestedByRole: 'restaurant_owner',
        amount: 300000,
        reason: 'Khách khiếu nại chất lượng',
        status: 'requested'
      }
    ]);
    console.log('Created 3 test refunds');

    // Create 3 Withdrawals
    await WithdrawalRequest.create([
      {
        ownerId: owner._id,
        restaurantId: restaurant._id,
        amount: 2500000,
        bankInfo: {
          bankName: 'Vietcombank',
          accountNumber: '0123456789',
          accountHolder: owner.fullName || 'TEST OWNER',
        },
        note: 'Rút tiền doanh thu tuần 1',
        status: 'pending'
      },
      {
        ownerId: owner._id,
        restaurantId: restaurant._id,
        amount: 1500000,
        bankInfo: {
          bankName: 'Techcombank',
          accountNumber: '190333333333',
          accountHolder: owner.fullName || 'TEST OWNER',
        },
        note: 'Rút tiền doanh thu tuần 2',
        status: 'pending'
      },
      {
        ownerId: owner._id,
        restaurantId: restaurant._id,
        amount: 5000000,
        bankInfo: {
          bankName: 'MB Bank',
          accountNumber: '0987654321',
          accountHolder: owner.fullName || 'TEST OWNER',
        },
        note: 'Rút số dư khuyến mãi',
        status: 'pending'
      }
    ]);
    console.log('Created 3 test withdrawals');

    console.log('Seed completed successfully!');
    process.exit(0);
  } catch (e) {
    console.error('Seed Error:', e);
    process.exit(1);
  }
}

seed();
