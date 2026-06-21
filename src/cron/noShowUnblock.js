'use strict';

const User = require('../models/User');

/**
 * Reset noShowCounter và unblock người dùng hết hạn block.
 * Chạy mỗi ngày lúc 0h.
 */
const noShowUnblock = async () => {
  const now = new Date();

  try {
    // Unblock users whose block has expired
    const unblocked = await User.updateMany(
      {
        noShowCounter: { $gte: 3 },
        bookingBlockedUntil: { $lte: now, $ne: null },
      },
      {
        $set: { noShowCounter: 0, bookingBlockedUntil: null },
      }
    );

    if (unblocked.modifiedCount > 0) {
      console.log(`[Cron] Unblocked ${unblocked.modifiedCount} users`);
    }
  } catch (err) {
    console.error('[Cron/NoShowUnblock] Error:', err.message);
  }
};

module.exports = noShowUnblock;
