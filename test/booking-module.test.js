const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const RestaurantTable = require('../src/models/RestaurantTable');
const TableReservation = require('../src/models/TableReservation');
const Booking = require('../src/models/Booking');
const emailService = require('../src/services/email.service');
const bookingController = require('../src/controllers/booking.controller');
const bookingService = require('../src/services/booking.service');
const ownerBookingController = require('../src/controllers/owner.booking.controller');
const adminBookingController = require('../src/controllers/admin.booking.controller');
const { verifyOwnerBookingAccess } = require('../src/middleware/booking.middleware');

const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const makeOperatingHours = () => Object.fromEntries(
  dayNames.map((day) => [day, { open: '10:00', close: '22:00', closed: false }])
);

const futureDateString = (days = 5) => new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

const normalizeDateForQuery = (dateString) => new Date(`${dateString}T00:00:00.000Z`);

const createResponse = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
};

const createRequest = ({ user, body = {}, query = {}, params = {}, booking, restaurant, io } = {}) => ({
  user,
  body,
  query,
  params,
  booking,
  restaurant,
  app: {
    get(key) {
      if (key !== 'io') return null;
      return io || null;
    },
  },
});

const callController = async (controller, req) => {
  const res = createResponse();
  await controller(req, res, () => {});
  return res;
};

const createIoRecorder = () => {
  const events = [];
  return {
    events,
    io: {
      to(room) {
        return {
          emit(event, payload) {
            events.push({ room, event, payload });
          },
        };
      },
    },
  };
};

const createFixture = async (suffix, { createTables = true } = {}) => {
  const owner = await User.create({
    username: `${suffix}_owner`,
    email: `${suffix}_owner@example.com`,
    password: 'Password123!',
    fullName: 'Booking Owner',
    role: 'restaurant_owner',
    emailVerified: true,
  });

  const otherOwner = await User.create({
    username: `${suffix}_other_owner`,
    email: `${suffix}_other_owner@example.com`,
    password: 'Password123!',
    fullName: 'Other Owner',
    role: 'restaurant_owner',
    emailVerified: true,
  });

  const customer = await User.create({
    username: `${suffix}_customer`,
    email: `${suffix}_customer@example.com`,
    password: 'Password123!',
    fullName: 'Booking Customer',
    phoneNumber: '0901234567',
    role: 'customer',
    emailVerified: true,
  });

  const admin = await User.create({
    username: `${suffix}_admin`,
    email: `${suffix}_admin@example.com`,
    password: 'Password123!',
    fullName: 'Booking Admin',
    role: 'admin',
    emailVerified: true,
  });

  const restaurant = await Restaurant.create({
    ownerId: owner._id,
    name: `${suffix} Restaurant`,
    description: 'Temporary restaurant for booking tests',
    phoneNumber: '0901234567',
    email: `${suffix}_restaurant@example.com`,
    address: {
      street: '1 Test',
      ward: 'Ward',
      district: 'District',
      city: 'City',
      fullAddress: '1 Test, City',
    },
    coordinates: { latitude: 10.7769, longitude: 106.7009 },
    location: { type: 'Point', coordinates: [106.7009, 10.7769] },
    operatingHours: makeOperatingHours(),
    approvalStatus: 'approved',
    active: true,
  });

  const tables = {};
  if (createTables) {
    tables.tableA = await RestaurantTable.create({
      restaurantId: restaurant._id,
      tableNumber: `${suffix}_A1`,
      capacity: 4,
      zone: 'Main',
      status: 'available',
      isActive: true,
    });
    tables.tableB = await RestaurantTable.create({
      restaurantId: restaurant._id,
      tableNumber: `${suffix}_B1`,
      capacity: 4,
      zone: 'Main',
      status: 'available',
      isActive: true,
    });
    tables.tableOff = await RestaurantTable.create({
      restaurantId: restaurant._id,
      tableNumber: `${suffix}_OFF`,
      capacity: 8,
      zone: 'Main',
      status: 'maintenance',
      isActive: false,
    });
  }

  return {
    owner,
    otherOwner,
    customer,
    admin,
    restaurant,
    ...tables,
  };
};

const bookingBody = ({ restaurant, tableNumbers = [], date = futureDateString(), time = '18:00', guests = 2, suffix }) => ({
  restaurantId: restaurant._id.toString(),
  bookingDate: date,
  bookingTime: time,
  numberOfGuests: guests,
  customerName: 'Booking Customer',
  customerPhone: '0901234567',
  customerEmail: `${suffix}_customer@example.com`,
  tableNumbers,
});

const cleanup = async (suffix) => {
  const restaurants = await Restaurant.find({ name: new RegExp(`^${suffix}`) }).select('_id');
  const restaurantIds = restaurants.map((restaurant) => restaurant._id);
  await TableReservation.deleteMany({ restaurantId: { $in: restaurantIds } });
  await Booking.deleteMany({ restaurantId: { $in: restaurantIds } });
  await RestaurantTable.deleteMany({ restaurantId: { $in: restaurantIds } });
  await Restaurant.deleteMany({ _id: { $in: restaurantIds } });
  await User.deleteMany({ username: new RegExp(`^${suffix}`) });
};

test.before(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for booking tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('customer can create, cancel, and cannot double-book the same buffered table slot', async () => {
  const suffix = `booking_core_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);
    const date = futureDateString();
    const recorder = createIoRecorder();
    const createReq = createRequest({
      user: fixture.customer,
      io: recorder.io,
      body: bookingBody({
        restaurant: fixture.restaurant,
        tableNumbers: [fixture.tableA.tableNumber],
        date,
        suffix,
      }),
    });

    const createRes = await callController(bookingController.createBooking, createReq);
    assert.equal(createRes.statusCode, 201);
    assert.equal(createRes.body.data.status, 'pending');
    assert.deepEqual(createRes.body.data.tableNumbers, [fixture.tableA.tableNumber]);
    assert.equal(recorder.events[0].room, `restaurant:${fixture.restaurant._id.toString()}`);

    const conflictReq = createRequest({
      user: fixture.customer,
      body: bookingBody({
        restaurant: fixture.restaurant,
        tableNumbers: [fixture.tableA.tableNumber],
        date,
        time: '18:30',
        suffix: `${suffix}_conflict`,
      }),
    });
    const conflictRes = await callController(bookingController.createBooking, conflictReq);
    assert.equal(conflictRes.statusCode, 400);

    const booking = await Booking.findById(createRes.body.data.id);
    const cancelRes = await callController(
      bookingController.cancelBooking,
      createRequest({
        user: fixture.customer,
        booking,
        body: { reason: 'Customer changed plan' },
      }),
    );

    assert.equal(cancelRes.statusCode, 200);
    const cancelled = await Booking.findById(booking._id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancelledBy, 'customer');
    assert.equal(cancelled.statusHistory.at(-1).status, 'cancelled');
  } finally {
    await cleanup(suffix);
  }
});

test('restaurant without tables still accepts customer booking without assigned tables', async () => {
  const suffix = `booking_notable_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix, { createTables: false });
    const res = await callController(
      bookingController.createBooking,
      createRequest({
        user: fixture.customer,
        body: bookingBody({ restaurant: fixture.restaurant, tableNumbers: [], suffix }),
      }),
    );

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body.data.tableNumbers, []);
    assert.equal(res.body.data.status, 'pending');

    const booking = await Booking.findById(res.body.data.id);
    const confirmRes = await callController(
      ownerBookingController.confirmBooking,
      createRequest({
        user: fixture.owner,
        booking,
        restaurant: fixture.restaurant,
      }),
    );
    assert.equal(confirmRes.statusCode, 400);
    assert.match(confirmRes.body.message, /gán bàn/i);
  } finally {
    await cleanup(suffix);
  }
});

test('owner can confirm, complete, mark no-show, change table, and wrong owner is denied', async () => {
  const suffix = `booking_owner_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);
    const date = futureDateString();
    const booking = await Booking.create({
      customerId: fixture.customer._id,
      restaurantId: fixture.restaurant._id,
      bookingDate: normalizeDateForQuery(date),
      bookingTime: '18:00',
      numberOfGuests: 2,
      customerName: 'Booking Customer',
      customerPhone: '0901234567',
      customerEmail: `${suffix}_customer@example.com`,
      tableNumbers: [fixture.tableA.tableNumber],
      status: 'pending',
      statusHistory: [{ status: 'pending', changedBy: fixture.customer._id, note: 'seed' }],
    });

    const otherOwnerReq = createRequest({
      user: fixture.otherOwner,
      params: { id: booking._id.toString() },
    });
    const otherOwnerRes = createResponse();
    await verifyOwnerBookingAccess(otherOwnerReq, otherOwnerRes, () => {
      otherOwnerRes.nextCalled = true;
    });
    assert.equal(otherOwnerRes.statusCode, 403);
    assert.equal(otherOwnerRes.nextCalled, undefined);

    const confirmRecorder = createIoRecorder();
    const confirmRes = await callController(
      ownerBookingController.confirmBooking,
      createRequest({
        user: fixture.owner,
        booking,
        restaurant: fixture.restaurant,
        io: confirmRecorder.io,
      }),
    );
    assert.equal(confirmRes.statusCode, 200);
    assert.equal(confirmRes.body.data.status, 'confirmed');
    assert.equal(confirmRecorder.events[0].room, `user:${fixture.customer._id.toString()}`);

    const confirmed = await Booking.findById(booking._id);
    const changeRes = await callController(
      ownerBookingController.changeTable,
      createRequest({
        user: fixture.owner,
        booking: confirmed,
        restaurant: fixture.restaurant,
        body: { newTableNumbers: [fixture.tableB.tableNumber] },
      }),
    );
    assert.equal(changeRes.statusCode, 200);
    assert.deepEqual(changeRes.body.data.tableNumbers, [fixture.tableB.tableNumber]);

    const changedReservations = await TableReservation.find({ bookingId: booking._id });
    assert.deepEqual([...new Set(changedReservations.map((item) => item.tableNumber))], [fixture.tableB.tableNumber]);
    assert.ok(changedReservations.length > 1, 'booking duration must be protected by multiple reservation slots');

    const changed = await Booking.findById(booking._id);
    changed.checkedInAt = new Date();
    await changed.save();
    const earlyCompleteRes = await callController(
      ownerBookingController.completeBooking,
      createRequest({
        user: fixture.owner,
        booking: changed,
        restaurant: fixture.restaurant,
        body: { actualGuestCount: 2 },
      }),
    );
    assert.equal(earlyCompleteRes.statusCode, 200);
    assert.equal(earlyCompleteRes.body.data.status, 'completed');
    assert.equal(await TableReservation.countDocuments({ bookingId: booking._id }), 0);

    const noShowBooking = await Booking.create({
      customerId: fixture.customer._id,
      restaurantId: fixture.restaurant._id,
      bookingDate: normalizeDateForQuery(date),
      bookingTime: '21:00',
      numberOfGuests: 2,
      customerName: 'Booking Customer',
      customerPhone: '0901234567',
      customerEmail: `${suffix}_noshow@example.com`,
      tableNumbers: [fixture.tableA.tableNumber],
      status: 'confirmed',
      statusHistory: [{ status: 'confirmed', changedBy: fixture.owner._id, note: 'seed confirmed' }],
    });

    const earlyNoShowRes = await callController(
      ownerBookingController.markNoShow,
      createRequest({
        user: fixture.owner,
        booking: noShowBooking,
        restaurant: fixture.restaurant,
      }),
    );
    assert.equal(earlyNoShowRes.statusCode, 409);
    noShowBooking.bookingDate = normalizeDateForQuery(futureDateString(-2));
    await noShowBooking.save();
    const noShowRes = await callController(
      ownerBookingController.markNoShow,
      createRequest({
        user: fixture.owner,
        booking: noShowBooking,
        restaurant: fixture.restaurant,
      }),
    );
    assert.equal(noShowRes.statusCode, 200);
    assert.equal(noShowRes.body.data.status, 'no_show');
  } finally {
    await cleanup(suffix);
  }
});

test('admin cannot roll terminal or active bookings back to invalid statuses', async () => {
  const suffix = `booking_admin_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);
    const booking = await Booking.create({
      customerId: fixture.customer._id,
      restaurantId: fixture.restaurant._id,
      bookingDate: normalizeDateForQuery(futureDateString()),
      bookingTime: '18:00',
      numberOfGuests: 2,
      customerName: 'Booking Customer',
      customerPhone: '0901234567',
      customerEmail: `${suffix}_customer@example.com`,
      tableNumbers: [fixture.tableA.tableNumber],
      status: 'confirmed',
      statusHistory: [{ status: 'confirmed', changedBy: fixture.owner._id, note: 'seed confirmed' }],
    });

    const rollbackRes = await callController(
      adminBookingController.updateBookingStatus,
      createRequest({
        user: fixture.admin,
        params: { id: booking._id.toString() },
        body: { status: 'pending', note: 'invalid rollback' },
      }),
    );

    assert.equal(rollbackRes.statusCode, 400);
    const afterRollback = await Booking.findById(booking._id);
    assert.equal(afterRollback.status, 'confirmed');

    const cancelWithoutReasonRes = await callController(
      adminBookingController.updateBookingStatus,
      createRequest({
        user: fixture.admin,
        params: { id: booking._id.toString() },
        body: { status: 'cancelled' },
      }),
    );
    assert.equal(cancelWithoutReasonRes.statusCode, 400);

    const statsRes = await callController(
      adminBookingController.getBookingStats,
      createRequest({ user: fixture.admin }),
    );
    assert.equal(statsRes.statusCode, 200);
    assert.ok(statsRes.body.data.totalBookings >= 1);
    assert.ok(statsRes.body.data.confirmed >= 1);
  } finally {
    await cleanup(suffix);
  }
});

test('booking email functions exist and are called without blocking booking state changes', async () => {
  const suffix = `booking_email_${Date.now()}`;
  await cleanup(suffix);

  const calls = [];
  const originals = {
    sendBookingCreatedEmail: emailService.sendBookingCreatedEmail,
    sendBookingConfirmedEmail: emailService.sendBookingConfirmedEmail,
    sendBookingCancelledEmail: emailService.sendBookingCancelledEmail,
    sendBookingReminderEmail: emailService.sendBookingReminderEmail,
  };

  try {
    assert.equal(typeof emailService.sendBookingCreatedEmail, 'function');
    assert.equal(typeof emailService.sendBookingConfirmedEmail, 'function');
    assert.equal(typeof emailService.sendBookingCancelledEmail, 'function');
    assert.equal(typeof emailService.sendBookingReminderEmail, 'function');

    emailService.sendBookingCreatedEmail = async () => calls.push('created');
    emailService.sendBookingConfirmedEmail = async () => calls.push('confirmed');
    emailService.sendBookingCancelledEmail = async () => calls.push('cancelled');
    emailService.sendBookingReminderEmail = async () => calls.push('reminder');

    const fixture = await createFixture(suffix);
    const createRes = await callController(
      bookingController.createBooking,
      createRequest({
        user: fixture.customer,
        body: bookingBody({
          restaurant: fixture.restaurant,
          tableNumbers: [fixture.tableA.tableNumber],
          suffix,
        }),
      }),
    );
    assert.equal(createRes.statusCode, 201);

    const booking = await Booking.findById(createRes.body.data.id);
    const confirmRes = await callController(
      ownerBookingController.confirmBooking,
      createRequest({
        user: fixture.owner,
        booking,
        restaurant: fixture.restaurant,
      }),
    );
    assert.equal(confirmRes.statusCode, 200);

    const confirmed = await Booking.findById(booking._id);
    const cancelRes = await callController(
      ownerBookingController.cancelBooking,
      createRequest({
        user: fixture.owner,
        booking: confirmed,
        restaurant: fixture.restaurant,
        body: { reason: 'Kitchen maintenance' },
      }),
    );
    assert.equal(cancelRes.statusCode, 200);

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['created', 'confirmed', 'cancelled']);
  } finally {
    Object.assign(emailService, originals);
    await cleanup(suffix);
  }
});

test('database slot keys reject overlapping minute offsets and roll back multi-table inserts', async () => {
  const suffix = `booking_slots_${Date.now()}`;
  await cleanup(suffix);
  try {
    const fixture = await createFixture(suffix);
    const date = futureDateString();
    const winnerId = new mongoose.Types.ObjectId();
    const loserId = new mongoose.Types.ObjectId();

    const [first, second] = await Promise.all([
      bookingService.reserveTables(
        fixture.restaurant._id, [fixture.tableA.tableNumber], date, '18:05', winnerId,
      ),
      bookingService.reserveTables(
        fixture.restaurant._id, [fixture.tableA.tableNumber], date, '18:10', loserId,
      ),
    ]);
    assert.equal([first.success, second.success].filter(Boolean).length, 1);

    const occupiedBookingId = first.success ? winnerId : loserId;
    const multiTableBookingId = new mongoose.Types.ObjectId();
    const multi = await bookingService.reserveTables(
      fixture.restaurant._id,
      [fixture.tableB.tableNumber, fixture.tableA.tableNumber],
      date,
      '18:07',
      multiTableBookingId,
    );
    assert.equal(multi.success, false);
    assert.equal(
      await TableReservation.countDocuments({ bookingId: multiTableBookingId }),
      0,
      'transaction must remove slots inserted before the conflicting table',
    );
    assert.ok(await TableReservation.countDocuments({ bookingId: occupiedBookingId }));
  } finally {
    await cleanup(suffix);
  }
});

test('failed reschedule preserves both the old booking fields and old reservation slots', async () => {
  const suffix = `booking_reschedule_${Date.now()}`;
  await cleanup(suffix);
  try {
    const fixture = await createFixture(suffix);
    const oldDate = futureDateString(5);
    const newDate = futureDateString(6);
    const booking = await Booking.create({
      customerId: fixture.customer._id,
      restaurantId: fixture.restaurant._id,
      bookingDate: normalizeDateForQuery(oldDate),
      bookingTime: '18:00',
      numberOfGuests: 2,
      customerName: 'Booking Customer',
      customerPhone: '0901234567',
      customerEmail: `${suffix}_customer@example.com`,
      tableNumbers: [fixture.tableA.tableNumber],
      status: 'pending',
      statusHistory: [{ status: 'pending', changedBy: fixture.customer._id, note: 'seed' }],
    });
    assert.equal((await bookingService.reserveTables(
      fixture.restaurant._id, [fixture.tableA.tableNumber], oldDate, '18:00', booking._id,
    )).success, true);
    const blockerId = new mongoose.Types.ObjectId();
    assert.equal((await bookingService.reserveTables(
      fixture.restaurant._id, [fixture.tableB.tableNumber], newDate, '19:00', blockerId,
    )).success, true);
    const oldSlotCount = await TableReservation.countDocuments({ bookingId: booking._id });

    await assert.rejects(
      bookingService.rescheduleBookingAtomic({
        bookingId: booking._id,
        bookingDate: newDate,
        bookingTime: '19:00',
        tableNumbers: [fixture.tableB.tableNumber],
        actorId: fixture.customer._id,
      }),
      (error) => error.code === 'TABLE_ALREADY_RESERVED',
    );

    const unchanged = await Booking.findById(booking._id);
    assert.equal(unchanged.bookingDate.toISOString().slice(0, 10), oldDate);
    assert.equal(unchanged.bookingTime, '18:00');
    assert.deepEqual(unchanged.tableNumbers, [fixture.tableA.tableNumber]);
    assert.equal(await TableReservation.countDocuments({ bookingId: booking._id }), oldSlotCount);
  } finally {
    await cleanup(suffix);
  }
});

test('owner manual guest booking keeps customerId null and cancels without a fake wallet refund', async () => {
  const suffix = `booking_guest_${Date.now()}`;
  await cleanup(suffix);
  try {
    const fixture = await createFixture(suffix);
    const createRes = await callController(
      ownerBookingController.ownerCreateBooking,
      createRequest({
        user: fixture.owner,
        body: {
          restaurantId: fixture.restaurant._id.toString(),
          bookingDate: futureDateString(),
          bookingTime: '18:00',
          numberOfGuests: 2,
          customerName: 'Walk-in Guest',
          customerPhone: '0907654321',
          customerEmail: '',
          tableNumbers: [fixture.tableA.tableNumber],
          setConfirmed: true,
        },
      }),
    );
    assert.equal(createRes.statusCode, 201);
    const guestBooking = await Booking.findById(createRes.body.data._id || createRes.body.data.id);
    assert.equal(guestBooking.customerId, null);

    const cancelRes = await callController(
      ownerBookingController.cancelBooking,
      createRequest({
        user: fixture.owner,
        booking: guestBooking,
        restaurant: fixture.restaurant,
        body: { reason: 'Khách vãng lai đổi lịch' },
      }),
    );
    assert.equal(cancelRes.statusCode, 200);
    assert.equal(cancelRes.body.data.refundAmount, 0);
    assert.equal(await TableReservation.countDocuments({ bookingId: guestBooking._id }), 0);
  } finally {
    await cleanup(suffix);
  }
});
