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
  slotStartUtc: {
    type: Date,
    default: null,
  },
  slotEndUtc: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Database lock for overlapping intervals represented as fixed-size slots.
tableReservationSchema.index(
  { restaurantId: 1, tableNumber: 1, slotStartUtc: 1 },
  {
    unique: true,
    partialFilterExpression: { slotStartUtc: { $type: 'date' } },
    name: 'unique_restaurant_table_slot',
  }
);

tableReservationSchema.index({ bookingId: 1 });
tableReservationSchema.index({ bookingId: 1, slotStartUtc: 1 });

module.exports = mongoose.model('TableReservation', tableReservationSchema);
