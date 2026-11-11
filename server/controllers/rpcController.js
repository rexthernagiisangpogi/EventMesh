const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');
const db = require('../config/database');
const {
  generateTicketSignature,
  verifyTicketSignature,
} = require('../middleware/cryptoAuth');
const { broadcastSystemState } = require('../websocket/wsHub');

function requireText(value, field, maxLength = 200) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new TypeError(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function requireSeatId(value) {
  const seatId = requireText(value, 'seat_id', 100);
  if (seatId.includes(':') || seatId.includes('/')) {
    throw new TypeError('seat_id cannot contain ":" or "/"');
  }
  return seatId;
}

function parseTicketPayload(payload) {
  if (typeof payload !== 'string') return null;
  const parts = payload.trim().split(':');
  return parts.length === 3 && parts.every(Boolean) && !parts[1].includes('/')
    ? parts
    : null;
}

function parseScanTime(timestamp) {
  if (timestamp === undefined || timestamp === null) return new Date();
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new TypeError('timestamp must be a positive Unix timestamp in seconds');
  }
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) throw new TypeError('timestamp is invalid');
  return date;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  return new Date(value);
}

async function publishSystemState(alert = null) {
  try {
    await broadcastSystemState(alert);
  } catch (error) {
    console.error('[System State Broadcast Error]:', error);
  }
}

async function LockSeatProcedure({
  seat_id,
  node_id,
  timeout = 180,
} = {}) {
  seat_id = requireSeatId(seat_id);
  node_id = requireText(node_id, 'node_id', 100);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600) {
    throw new TypeError('timeout must be an integer between 1 and 600 seconds');
  }

  const seatRef = db.collection('seats').doc(seat_id);
  const result = await db.runTransaction(async (transaction) => {
    const seatSnapshot = await transaction.get(seatRef);
    if (!seatSnapshot.exists) {
      return { success: false, message: 'Seat does not exist.' };
    }

    const seat = seatSnapshot.data();
    const lockExpiration = toDate(seat.lock_expiration);
    const expired = seat.status === 'HELD' &&
      (!lockExpiration || lockExpiration.getTime() <= Date.now());
    const alreadyHeldByNode = seat.status === 'HELD' && seat.locked_by === node_id;
    if (seat.status !== 'AVAILABLE' && !expired && !alreadyHeldByNode) {
      return {
        success: false,
        message: `Concurrency conflict: Seat is currently ${seat.status} (Held by ${seat.locked_by || 'another user'}).`,
      };
    }

    transaction.update(seatRef, {
      status: 'HELD',
      locked_by: node_id,
      lock_expiration: Timestamp.fromDate(new Date(Date.now() + timeout * 1000)),
    });
    return { success: true };
  });

  if (!result.success) return result;
  await publishSystemState();
  return {
    success: true,
    message: `Seat ${seat_id} locked by ${node_id} for ${timeout}s.`,
  };
}

async function BookSeatProcedure({
  seat_id,
  node_id,
  attendee_name,
} = {}) {
  seat_id = requireSeatId(seat_id);
  node_id = requireText(node_id, 'node_id', 100);
  attendee_name = requireText(attendee_name, 'attendee_name');

  const ticketId = uuidv4();
  const seatRef = db.collection('seats').doc(seat_id);
  const ticketRef = db.collection('tickets').doc(ticketId);
  const result = await db.runTransaction(async (transaction) => {
    const seatSnapshot = await transaction.get(seatRef);
    if (!seatSnapshot.exists) {
      return { success: false, message: 'Seat not found.' };
    }

    const seat = seatSnapshot.data();
    if (seat.status !== 'HELD' || seat.locked_by !== node_id ||
        !toDate(seat.lock_expiration) || toDate(seat.lock_expiration).getTime() <= Date.now()) {
      return {
        success: false,
        message: 'Lock expired or owned by another terminal. Please re-select seat.',
      };
    }

    const qrPayload = `${ticketId}:${seat_id}:${generateTicketSignature(ticketId, seat_id)}`;
    transaction.update(seatRef, {
      status: 'BOOKED',
      locked_by: null,
      lock_expiration: null,
    });
    transaction.set(ticketRef, {
      ticket_id: ticketId,
      seat_id,
      seat_label: `${seat.row_number}${seat.seat_number}`,
      attendee_name,
      qr_hash: qrPayload,
      is_validated: false,
      validated_at: null,
      validated_by_terminal: null,
      created_at: Timestamp.now(),
    });
    return {
      success: true,
      ticket: {
        ticket_id: ticketId,
        seat_id,
        seat_label: `${seat.row_number}${seat.seat_number}`,
        attendee_name,
        qr_hash: qrPayload,
      },
    };
  });

  if (!result.success) return result;
  await publishSystemState();
  return {
    success: true,
    message: 'Ticket booked and cryptographically signed.',
    ticket: result.ticket,
  };
}

async function ValidateTicketProcedure({
  ticket_hash,
  terminal_id,
  timestamp,
} = {}) {
  const parts = parseTicketPayload(ticket_hash);
  if (!parts) {
    return { success: false, status: 'INVALID_FORMAT', message: 'Malformed QR Code payload.' };
  }
  const [ticketId, seatId, signature] = parts;
  if (!verifyTicketSignature(ticketId, seatId, signature)) {
    return {
      success: false,
      status: 'FORGED_SIGNATURE',
      message: 'Cryptographic HMAC verification failed! Counterfeit ticket.',
    };
  }
  terminal_id = requireText(terminal_id, 'terminal_id', 100);
  const scanTime = parseScanTime(timestamp);

  const ticketRef = db.collection('tickets').doc(ticketId);
  const seatRef = db.collection('seats').doc(seatId);
  const logRef = db.collection('entry_logs').doc();
  const outcome = await db.runTransaction(async (transaction) => {
    const ticketSnapshot = await transaction.get(ticketRef);
    const seatSnapshot = ticketSnapshot.exists
      ? await transaction.get(seatRef)
      : null;
    if (!ticketSnapshot.exists || ticketSnapshot.data().seat_id !== seatId) {
      return {
        result: {
          success: false,
          status: 'NOT_FOUND',
          message: 'Ticket record not found in central DB.',
        },
      };
    }

    const ticket = ticketSnapshot.data();
    const seat = seatSnapshot.exists ? seatSnapshot.data() : null;
    const seatLabel = seat
      ? `${seat.row_number}${seat.seat_number}`
      : ticket.seat_label || seatId;
    if (ticket.is_validated) {
      const alert = {
        code: 'DUPLICATE_ENTRY_ALERT',
        ticket_id: ticketId,
        attendee_name: ticket.attendee_name,
        first_terminal: ticket.validated_by_terminal,
        conflicting_terminal: terminal_id,
        message: `Duplicate entry attempt for ${ticket.attendee_name} (Seat ${seatLabel}) at ${terminal_id}! Already validated by ${ticket.validated_by_terminal}.`,
      };
      return {
        alert,
        result: { success: false, status: 'ALREADY_VALIDATED', message: alert.message },
      };
    }

    transaction.update(ticketRef, {
      is_validated: true,
      validated_at: Timestamp.fromDate(scanTime),
      validated_by_terminal: terminal_id,
    });
    transaction.set(logRef, {
      ticket_id: ticketId,
      terminal_id,
      scan_timestamp: Timestamp.fromDate(scanTime),
      sync_status: 'SYNCED',
      attendee_name: ticket.attendee_name,
    });

    return {
      result: {
        success: true,
        status: 'VALIDATED',
        message: `Access Granted: ${ticket.attendee_name} (Seat ${seatLabel})`,
        attendee: ticket.attendee_name,
        seat: seatLabel,
      },
    };
  });

  await publishSystemState(outcome.alert || null);
  return outcome.result;
}

async function SyncOfflineBatchProcedure() {
  return {
    success: false,
    status: 'OFFLINE_SYNC_DISABLED',
    message: 'Offline ticket validation is disabled. Tickets must be validated online.',
  };
}

module.exports = {
  LockSeatProcedure,
  BookSeatProcedure,
  ValidateTicketProcedure,
  SyncOfflineBatchProcedure,
};
