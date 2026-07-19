const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../src/models/User');
const Booking = require('../src/models/Booking');
const Voucher = require('../src/models/Voucher');
const CustomerVoucher = require('../src/models/CustomerVoucher');
const VoucherRedemption = require('../src/models/VoucherRedemption');
const VoucherAuditLog = require('../src/models/VoucherAuditLog');
const Restaurant = require('../src/models/Restaurant');

const validationService = require('../src/services/voucher.validation.service');
const voucherService = require('../src/services/voucher.service');

const cleanup = async (suffix) => {
  const users = await User.find({ username: new RegExp(`^${suffix}`) }).distinct('_id');
  const vouchers = await Voucher.find({ code: new RegExp(`^${suffix}`) }).distinct('_id');
  
  await CustomerVoucher.deleteMany({ customerId: { $in: users } });
  await VoucherRedemption.deleteMany({ voucherId: { $in: vouchers } });
  await VoucherAuditLog.deleteMany({ voucherId: { $in: vouchers } });
  await Booking.deleteMany({ customerId: { $in: users } });
  await Voucher.deleteMany({ _id: { $in: vouchers } });
  await Restaurant.deleteMany({ name: new RegExp(`^${suffix}`) });
  await User.deleteMany({ _id: { $in: users } });
};

test.before(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for voucher tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('Customer segments validation logic', async () => {
  const suffix = `SEG_TEST_${Date.now()}`;
  await cleanup(suffix);

  try {
    // 1. Create a customer (new user, 0 bookings)
    const customer = await User.create({
      username: `${suffix}_cust`,
      email: `${suffix}_cust@example.com`,
      password: 'Password123!',
      fullName: 'New User Customer',
      role: 'customer',
      emailVerified: true,
    });

    // 2. Create vouchers targeting different segments
    const voucherNew = await Voucher.create({
      name: 'New User Discount',
      code: `${suffix}_NEW`,
      discountType: 'percentage',
      discountValue: 10,
      minOrderAmount: 0,
      startDate: new Date(),
      status: 'active',
      customerSegments: ['new_user'],
      createdBy: new mongoose.Types.ObjectId(),
    });

    const voucherVip = await Voucher.create({
      name: 'VIP Discount',
      code: `${suffix}_VIP`,
      discountType: 'percentage',
      discountValue: 20,
      minOrderAmount: 0,
      startDate: new Date(),
      status: 'active',
      customerSegments: ['vip'],
      createdBy: new mongoose.Types.ObjectId(),
    });

    // 3. Test checkCustomerSegment for new user
    // 3a. Test new user trying to use voucherNew (should pass)
    const segRes1 = await validationService.checkCustomerSegment(voucherNew, customer._id);
    assert.equal(segRes1.valid, true);

    // 3b. Test new user trying to use voucherVip (should fail)
    const segRes2 = await validationService.checkCustomerSegment(voucherVip, customer._id);
    assert.equal(segRes2.valid, false);
    assert.match(segRes2.reason, /chỉ áp dụng cho nhóm khách hàng/i);

    // 4. Update bookings to make user VIP
    // Create 5 completed bookings
    const bookingsData = Array.from({ length: 5 }).map((_, idx) => ({
      customerId: customer._id,
      restaurantId: new mongoose.Types.ObjectId(),
      bookingDate: new Date(Date.now() - (6 - idx) * 24 * 60 * 60 * 1000),
      bookingTime: '19:00',
      numberOfGuests: 2,
      depositAmount: 50000,
      status: 'completed',
      voucherCode: `${suffix}_FAKE_${idx}`,
      originalAmount: 100000,
      finalAmount: 100000,
      customerName: 'New User Customer',
      customerEmail: 'customer@example.com',
      customerPhone: '0907777777',
    }));
    await Booking.insertMany(bookingsData);

    // 5. Test VIP segment (should pass voucherVip and fail voucherNew)
    const segRes3 = await validationService.checkCustomerSegment(voucherVip, customer._id);
    assert.equal(segRes3.valid, true);

    const segRes4 = await validationService.checkCustomerSegment(voucherNew, customer._id);
    assert.equal(segRes4.valid, false);

  } finally {
    await cleanup(suffix);
  }
});

test('Voucher redemption reversal logic', async () => {
  const suffix = `REV_TEST_${Date.now()}`;
  await cleanup(suffix);

  try {
    // 1. Create fixtures
    const customer = await User.create({
      username: `${suffix}_cust`,
      email: `${suffix}_cust@example.com`,
      password: 'Password123!',
      fullName: 'Redemption Customer',
      role: 'customer',
      emailVerified: true,
    });

    const restaurant = await Restaurant.create({
      ownerId: new mongoose.Types.ObjectId(),
      name: `${suffix} Restaurant`,
      description: 'Temporary restaurant for voucher tests',
      cuisineTypes: ['Vietnamese'],
      phoneNumber: '0901234567',
      email: `${suffix}_restaurant@example.com`,
      address: {
        street: '1 Test St',
        ward: 'Ward',
        district: 'District',
        city: 'City',
        fullAddress: '1 Test St, City',
      },
      approvalStatus: 'approved',
      active: true,
    });

    const voucher = await Voucher.create({
      name: 'Reversal Test Voucher',
      code: `${suffix}_CODE`,
      discountType: 'fixed_amount',
      discountValue: 30000,
      minOrderAmount: 50000,
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      globalUsageLimit: 5,
      perCustomerLimit: 1,
      status: 'active',
      createdBy: new mongoose.Types.ObjectId(),
    });

    // Save to customer wallet
    await voucherService.saveVoucherForCustomer(voucher._id, customer._id);

    // Create a mock booking
    const booking = await Booking.create({
      customerId: customer._id,
      restaurantId: restaurant._id,
      bookingDate: new Date(),
      bookingTime: '19:00',
      numberOfGuests: 2,
      depositAmount: 50000,
      status: 'pending',
      voucherCode: voucher.code,
      originalAmount: 100000,
      finalAmount: 70000,
      customerName: 'Redemption Customer',
      customerEmail: 'customer@example.com',
      customerPhone: '0907777777',
    });

    // 2. Perform redemption
    const redemption = await voucherService.redeemVoucher(
      voucher.code,
      restaurant._id,
      customer._id,
      100000,
      booking._id
    );
    assert.ok(redemption);
    assert.equal(redemption.status, 'completed');

    // Verify usage incremented
    const voucherAfterRedeem = await Voucher.findById(voucher._id);
    assert.equal(voucherAfterRedeem.currentUsage, 1);

    // Verify wallet status is used
    const walletAfterRedeem = await CustomerVoucher.findOne({ customerId: customer._id, voucherId: voucher._id });
    assert.equal(walletAfterRedeem.status, 'used');
    assert.equal(walletAfterRedeem.isUsed, true);

    // 3. Customer cannot restore after the configured window, but restaurant fault can.
    await VoucherRedemption.updateOne(
      { _id: redemption._id },
      { $set: { usedAt: new Date(Date.now() - 31 * 60 * 1000) } },
    );
    const customerLateReversal = await voucherService.reverseRedemption(
      booking._id,
      'Khách hủy muộn',
      { _id: customer._id, role: 'customer' },
    );
    assert.equal(customerLateReversal, null);
    assert.equal((await Voucher.findById(voucher._id)).currentUsage, 1);

    const reversed = await voucherService.reverseRedemption(
      booking._id,
      'Nhà hàng hủy đặt bàn',
      { _id: restaurant.ownerId, role: 'restaurant_owner' },
    );
    assert.ok(reversed);
    assert.equal(reversed.status, 'reversed');

    // Verify usage decremented back to 0
    const voucherAfterReverse = await Voucher.findById(voucher._id);
    assert.equal(voucherAfterReverse.currentUsage, 0);

    // Verify wallet status is back to saved & unused
    const walletAfterReverse = await CustomerVoucher.findOne({ customerId: customer._id, voucherId: voucher._id });
    assert.equal(walletAfterReverse.status, 'saved');
    assert.equal(walletAfterReverse.isUsed, false);

    // Verify audit log generated for reverse
    const reverseLog = await VoucherAuditLog.findOne({ voucherId: voucher._id, action: 'reverse' });
    assert.ok(reverseLog);
    assert.equal(reverseLog.result, 'success');

  } finally {
    await cleanup(suffix);
  }
});
