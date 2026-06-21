const mongoose = require('mongoose');

const tableReservationSchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true,
  },
  tableNumber: {
    type: String,
    required: true,
    trim: true,
  },
  bookingDate: {
    type: Date,
    required: true,
  },
  bookingTime: {
    type: String,
    required: true,
    trim: true,
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Unique compound index — prevents double-booking atomically
tableReservationSchema.index(
  { restaurantId: 1, tableNumber: 1, bookingDate: 1, bookingTime: 1 },
  { unique: true }
);

tableReservationSchema.index({ bookingId: 1 });
tableReservationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('TableReservation', tableReservationSchema);
