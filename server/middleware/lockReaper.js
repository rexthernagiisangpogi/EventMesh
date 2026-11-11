const { Timestamp } = require('firebase-admin/firestore');
const db = require('../config/database');
const { broadcastSystemState } = require('../websocket/wsHub');

async function releaseExpiredLocks() {
  const now = Timestamp.now();
  const expiredSeats = await db.collection('seats')
    .where('status', '==', 'HELD')
    .where('lock_expiration', '<=', now)
    .orderBy('lock_expiration')
    .limit(100)
    .get();

  let releasedCount = 0;
  for (const document of expiredSeats.docs) {
    const released = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(document.ref);
      if (!current.exists) return false;
      const seat = current.data();
      if (seat.status !== 'HELD' || !seat.lock_expiration ||
          seat.lock_expiration.toMillis() > Date.now()) {
        return false;
      }

      transaction.update(document.ref, {
        status: 'AVAILABLE',
        locked_by: null,
        lock_expiration: null,
      });
      return true;
    });
    if (released) releasedCount++;
  }

  if (releasedCount > 0) {
    console.log(`[Lock Reaper] Released ${releasedCount} expired seat lock(s).`);
    await broadcastSystemState();
  }
}

function startLockReaper() {
  const timer = setInterval(() => {
    releaseExpiredLocks().catch((error) => {
      console.error('[Lock Reaper Error]:', error);
    });
  }, 5000);
  timer.unref();
  return timer;
}

module.exports = { startLockReaper, releaseExpiredLocks };
