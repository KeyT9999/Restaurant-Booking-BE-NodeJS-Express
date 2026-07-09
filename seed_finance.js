'use strict';
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Restaurant = require('./src/models/Restaurant');
const User = require('./src/models/User');
const Refund = require('./src/models/Refund');
const Payment = require('./src/models/Payment');
const WithdrawalRequest = require('./src/models/WithdrawalRequest');

const seedFinance = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const restaurants = await Restaurant.find().limit(3);
    if (restaurants.length === 0) {
      console.log('❌ No restaurants found. Please run test seeds first.');
      process.exit(1);
    }

    const customers = await User.find({ role: 'customer' }).limit(3);
    if (customers.length === 0) {
      console.log('❌ No customers found. Please run test seeds first.');
      process.exit(1);
    }

    // ─── Tạo Payment giả để Refund có thể reference ────────────────
    console.log('Creating mock Payments for Refunds...');
    const mockPayments = [];
    for (let i = 0; i < 3; i++) {
      const restaurant = restaurants[i % restaurants.length];
      const customer = customers[i % customers.length];
      const orderCode = Math.floor(Math.random() * 9000000000) + 1000000000;
      const payment = await Payment.create({
        userId: customer._id,
        targetType: 'booking',
        targetId: new mongoose.Types.ObjectId(),
        restaurantId: restaurant._id,
        amount: (Math.floor(Math.random() * 5) + 1) * 100000,
        status: 'paid',
        orderCode,
        paidAt: new Date(),
        description: `Đặt cọc bàn - Seed ${i + 1}`,
      });
      mockPayments.push(payment);
    }
    console.log(`Created ${mockPayments.length} mock Payments`);

    // ─── Tạo Refund Requests ────────────────────────────────────────
    console.log('Creating Refund requests...');
    const statuses = ['requested', 'approved', 'rejected'];
    for (let i = 0; i < 3; i++) {
      const payment = mockPayments[i];
      await Refund.create({
        paymentId: payment._id,
        bookingId: payment.targetId,
        requestedBy: payment.userId,
        requestedByRole: 'customer',
        amount: payment.amount,
        reason: ['Khách hàng hủy bàn trước 24h', 'Nhà hàng không xác nhận kịp thời', 'Thay đổi kế hoạch đột ngột'][i],
        status: statuses[i],
        adminNote: i > 0 ? (i === 1 ? 'Đã xét duyệt, hoàn tiền về ví nhà hàng' : 'Không đủ điều kiện hoàn tiền') : null,
        refundedAt: i === 1 ? new Date() : null,
      });
    }
    console.log('✅ Created 3 Refund requests (requested / approved / rejected)');

    // ─── Tạo Withdrawal Requests ────────────────────────────────────
    console.log('Creating Withdrawal requests...');
    const withdrawalStatuses = ['pending', 'approved', 'completed'];
    for (let i = 0; i < 3; i++) {
      const restaurant = restaurants[i % restaurants.length];
      await WithdrawalRequest.create({
        ownerId: restaurant.ownerId,
        restaurantId: restaurant._id,
        amount: (Math.floor(Math.random() * 10) + 5) * 1000000,
        status: withdrawalStatuses[i],
        bankInfo: {
          bankName: ['Vietcombank', 'Techcombank', 'MB Bank'][i],
          accountNumber: '10' + Math.floor(Math.random() * 100000000),
          accountHolder: restaurant.name.toUpperCase().substring(0, 30),
        },
        note: `Rút tiền doanh thu ${['tháng 6', 'tháng 5', 'tháng 4'][i]}`,
        proofImage: i === 2
          ? 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg'
          : null,
        adminNote: i === 2 ? 'Đã chuyển khoản thành công' : null,
        completedAt: i === 2 ? new Date() : null,
      });
    }
    console.log('✅ Created 3 Withdrawal requests (pending / approved / completed)');

    console.log('\n🎉 Finance seeding completed!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding finance:', err.message, err);
    process.exit(1);
  }
};

seedFinance();
