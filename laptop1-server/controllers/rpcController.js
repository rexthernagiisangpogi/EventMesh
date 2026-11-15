const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { Timestamp } = db;
const {
  generateTicketSignature,
  verifyTicketSignature,
} = require('../middleware/cryptoAuth');
const { broadcastSystemState } = require('../websocket/wsHub');
const { assignSeatLabels } = require('../utils/seatLabels');

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

async function CreateEventProcedure({
  name,
  description = '',
  venue = '',
  date = '',
  image = '',
  total_seats,
} = {}) {
  name = requireText(name, 'name');
  const eventId = uuidv4();
  const eventData = {
    event_id: eventId,
    name,
    description: description.trim(),
    venue: venue.trim(),
    date: date.trim(),
    image: image.trim(),
    created_at: Timestamp.now(),
  };
  let createdCount = null;
  if (total_seats !== undefined) {
    validateSeatCount(total_seats);
    const eventRef = db.collection('events').doc(eventId);
    createdCount = await db.runTransaction(async (transaction) => {
      transaction.set(eventRef, eventData);
      return addMissingFlatSeats(transaction, eventId, total_seats, []);
    });
  } else {
    await db.collection('events').doc(eventId).set(eventData);
  }
  await publishSystemState();
  return {
    success: true,
    message: `Event "${name}" created.${createdCount === null ? '' : ` ${createdCount} seats created.`}`,
    event_id: eventId,
    ...(createdCount === null ? {} : { created_count: createdCount }),
  };
}

function validateSeatLayout(rows, cols) {
  if (!Number.isInteger(rows) || rows < 1 || rows > 50)
    throw new TypeError('rows must be an integer between 1 and 50');
  if (!Number.isInteger(cols) || cols < 1 || cols > 50)
    throw new TypeError('cols must be an integer between 1 and 50');
}

function validateSeatCount(total_seats) {
  if (!Number.isInteger(total_seats) || total_seats < 1 || total_seats > 2500)
    throw new TypeError('total_seats must be an integer between 1 and 2500');
}

function getSeatLabel(seat) {
  return seat.seat_label || `S${seat.seat_number}`;
}

async function addMissingSeats(transaction, event_id, rows, cols) {
  const missingSeats = [];
  for (let row = 1; row <= rows; row++) {
    for (let seatNumber = 1; seatNumber <= cols; seatNumber++) {
      const seatId = `${event_id}_R${row}S${seatNumber}`;
      const seatRef = db.collection('seats').doc(seatId);
      const seatSnapshot = await transaction.get(seatRef);
      if (!seatSnapshot.exists) missingSeats.push({ seatRef, seatId, row, seatNumber });
    }
  }

  for (const { seatRef, seatId, row, seatNumber } of missingSeats) {
    transaction.set(seatRef, {
      seat_id: seatId,
      event_id,
      row_number: row,
      seat_number: seatNumber,
      status: 'AVAILABLE',
      locked_by: null,
      lock_expiration: null,
    });
  }
  return missingSeats.length;
}

async function addMissingFlatSeats(transaction, event_id, total_seats, existingSeats) {
  const suffix = `${event_id}_S`;
  const highestNumber = existingSeats.reduce((highest, seat) => {
    if (!seat.seat_id?.startsWith(suffix)) return highest;
    const number = Number(seat.seat_id.slice(suffix.length));
    return Number.isInteger(number) ? Math.max(highest, number) : highest;
  }, 0);
  const seatsToAdd = Math.max(0, total_seats - existingSeats.length);
  const newSeats = [];
  let seatNumber = Math.max(existingSeats.length, highestNumber) + 1;

  while (newSeats.length < seatsToAdd) {
    const seatId = `${event_id}_S${seatNumber}`;
    const seatRef = db.collection('seats').doc(seatId);
    if (!(await transaction.get(seatRef)).exists) {
      newSeats.push({ seatId, seatRef, seatNumber });
    }
    seatNumber++;
  }

  for (const { seatId, seatRef, seatNumber: number } of newSeats) {
    transaction.set(seatRef, {
      seat_id: seatId,
      seat_label: `S${number}`,
      event_id,
      row_number: 1,
      seat_number: number,
      status: 'AVAILABLE',
      locked_by: null,
      lock_expiration: null,
    });
  }
  return newSeats.length;
}

async function UpdateEventProcedure({
  event_id,
  name,
  description = '',
  venue = '',
  date = '',
  image = '',
  rows,
  cols,
  total_seats,
} = {}) {
  event_id = requireText(event_id, 'event_id');
  name = requireText(name, 'name');
  const hasRows = rows !== undefined;
  const hasCols = cols !== undefined;
  const hasSeatCount = total_seats !== undefined;
  if (hasSeatCount && (hasRows || hasCols))
    throw new TypeError('Provide total_seats or rows and cols, not both');
  if (hasRows !== hasCols) throw new TypeError('rows and cols must be provided together');
  if (hasRows) validateSeatLayout(rows, cols);
  if (hasSeatCount) validateSeatCount(total_seats);

  const ref = db.collection('events').doc(event_id);
  const existingSeats = hasSeatCount
    ? (await db.collection('seats').where('event_id', '==', event_id).get()).docs.map((doc) => ({
        ...doc.data(),
        seat_id: doc.id,
      }))
    : [];
  const addedSeats = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const count = hasSeatCount
      ? await addMissingFlatSeats(transaction, event_id, total_seats, existingSeats)
      : hasRows ? await addMissingSeats(transaction, event_id, rows, cols) : 0;
    transaction.update(ref, {
      name,
      description: description.trim(),
      venue: venue.trim(),
      date: date.trim(),
      image: image.trim(),
    });
    return count;
  });
  if (addedSeats === null) return { success: false, message: 'Event not found.' };
  await publishSystemState();
  return {
    success: true,
    message: `Event "${name}" updated.${addedSeats ? ` ${addedSeats} seats added.` : ''}`,
    created_count: addedSeats,
  };
}

async function DeleteEventProcedure({ event_id } = {}) {
  event_id = requireText(event_id, 'event_id');
  const ref = db.collection('events').doc(event_id);
  const snap = await ref.get();
  if (!snap.exists) return { success: false, message: 'Event not found.' };
  await ref.delete();
  await publishSystemState();
  return { success: true, message: 'Event deleted.' };
}

async function CreateSeatProcedure({
  event_id,
  row_number,
  seat_number,
} = {}) {
  event_id = requireText(event_id, 'event_id');
  if (!Number.isInteger(row_number) || row_number < 1)
    throw new TypeError('row_number must be a positive integer');
  if (!Number.isInteger(seat_number) || seat_number < 1)
    throw new TypeError('seat_number must be a positive integer');
  const seat_id = `${event_id}_R${row_number}S${seat_number}`;
  const ref = db.collection('seats').doc(seat_id);
  const snap = await ref.get();
  if (snap.exists) return { success: false, message: 'Seat already exists.' };
  await ref.set({
    seat_id,
    seat_label: `S${seat_number}`,
    event_id,
    row_number,
    seat_number,
    status: 'AVAILABLE',
    locked_by: null,
    lock_expiration: null,
  });
  // NOTE: caller is responsible for broadcasting after bulk creation
  return { success: true, message: `Seat R${row_number}S${seat_number} created.`, seat_id };
}

async function CreateSeatsBatchProcedure({
  event_id,
  rows,
  cols,
  total_seats,
} = {}) {
  event_id = requireText(event_id, 'event_id');
  if (total_seats !== undefined) {
    validateSeatCount(total_seats);
    const existingSeats = (await db.collection('seats')
      .where('event_id', '==', event_id)
      .get()).docs.map((doc) => ({ ...doc.data(), seat_id: doc.id }));
    const eventRef = db.collection('events').doc(event_id);
    const createdCount = await db.runTransaction(async (transaction) => {
      if (!(await transaction.get(eventRef)).exists) return null;
      return addMissingFlatSeats(transaction, event_id, total_seats, existingSeats);
    });
    if (createdCount === null) return { success: false, message: 'Event not found.' };
    if (createdCount > 0) await publishSystemState();
    return { success: true, created_count: createdCount, message: `${createdCount} seats created.` };
  }

  if (!Number.isInteger(rows) || rows < 1 || rows > 50)
    throw new TypeError('rows must be an integer between 1 and 50');
  if (!Number.isInteger(cols) || cols < 1 || cols > 50)
    throw new TypeError('cols must be an integer between 1 and 50');

  const batch = db.batch();
  let count = 0;
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const seat_id = `${event_id}_R${r}S${c}`;
      batch.set(db.collection('seats').doc(seat_id), {
        seat_id,
        event_id,
        row_number: r,
        seat_number: c,
        status: 'AVAILABLE',
        locked_by: null,
        lock_expiration: null,
      });
      count++;
    }
  }
  await batch.commit();
  await publishSystemState();
  return { success: true, message: `${count} seats created.` };
}

async function ExpandEventSeatsProcedure({
  event_id,
  rows,
  cols,
  total_seats,
} = {}) {
  event_id = requireText(event_id, 'event_id');
  if (total_seats !== undefined) {
    validateSeatCount(total_seats);
    const existingSeats = (await db.collection('seats')
      .where('event_id', '==', event_id)
      .get()).docs.map((doc) => ({ ...doc.data(), seat_id: doc.id }));
    const eventRef = db.collection('events').doc(event_id);
    const createdCount = await db.runTransaction(async (transaction) => {
      if (!(await transaction.get(eventRef)).exists) return null;
      return addMissingFlatSeats(transaction, event_id, total_seats, existingSeats);
    });
    if (createdCount === null) return { success: false, message: 'Event not found.' };
    if (createdCount > 0) await publishSystemState();
    return {
      success: true,
      created_count: createdCount,
      message: createdCount === 0
        ? 'No new seats to add. Existing seats were not changed.'
        : `${createdCount} seats added. Existing seats were not changed.`,
    };
  }

  validateSeatLayout(rows, cols);

  const eventRef = db.collection('events').doc(event_id);
  const createdCount = await db.runTransaction(async (transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    if (!eventSnapshot.exists) return null;
    return addMissingSeats(transaction, event_id, rows, cols);
  });

  if (createdCount === null) return { success: false, message: 'Event not found.' };
  if (createdCount > 0) await publishSystemState();
  return {
    success: true,
    created_count: createdCount,
    message: createdCount === 0
      ? 'No new seats to add. Existing seats were not changed.'
      : `${createdCount} seats added. Existing seats were not changed.`,
  };
}

async function DeleteSeatProcedure({ seat_id } = {}) {
  seat_id = requireSeatId(seat_id);
  const ref = db.collection('seats').doc(seat_id);
  const snap = await ref.get();
  if (!snap.exists) return { success: false, message: 'Seat not found.' };
  if (snap.data().status !== 'AVAILABLE')
    return { success: false, message: 'Cannot delete a seat that is held or booked.' };
  await ref.delete();
  await publishSystemState();
  return { success: true, message: 'Seat deleted.' };
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
  attendee_address = '',
  attendee_phone = '',
  attendee_email = '',
} = {}) {
  seat_id = requireSeatId(seat_id);
  node_id = requireText(node_id, 'node_id', 100);
  attendee_name = requireText(attendee_name, 'attendee_name');

  const ticketId = uuidv4();
  const seatRef = db.collection('seats').doc(seat_id);
  const ticketRef = db.collection('tickets').doc(ticketId);
  const initialSeatSnapshot = await seatRef.get();
  const initialSeat = initialSeatSnapshot.data();
  const eventSeatSnapshot = initialSeat
    ? await db.collection('seats').where('event_id', '==', initialSeat.event_id).get()
    : { docs: [] };
  const eventSeats = assignSeatLabels(eventSeatSnapshot.docs.map((doc) => ({
    ...doc.data(),
    seat_id: doc.id,
  })));
  const seatLabel = eventSeats.find((seat) => seat.seat_id === seat_id)?.seat_label;
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

    const eventSnapshot = seat.event_id
      ? await transaction.get(db.collection('events').doc(seat.event_id))
      : null;
    const qrPayload = `${ticketId}:${seat_id}:${generateTicketSignature(ticketId, seat_id)}`;
    transaction.update(seatRef, {
      status: 'BOOKED',
      locked_by: null,
      lock_expiration: null,
    });
    transaction.set(ticketRef, {
      ticket_id: ticketId,
      seat_id,
      event_id: seat.event_id || null,
      event_name: eventSnapshot?.exists ? eventSnapshot.data().name : null,
      seat_label: seatLabel || getSeatLabel(seat),
      attendee_name,
      attendee_address: attendee_address.trim(),
      attendee_phone: attendee_phone.trim(),
      attendee_email: attendee_email.trim(),
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
        seat_label: seatLabel || getSeatLabel(seat),
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
      ? getSeatLabel(seat)
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

async function DeleteTicketProcedure({ ticket_id } = {}) {
  ticket_id = requireText(ticket_id, 'ticket_id', 100);
  const ticketRef = db.collection('tickets').doc(ticket_id);
  const outcome = await db.runTransaction(async (transaction) => {
    const ticketSnapshot = await transaction.get(ticketRef);
    if (!ticketSnapshot.exists) {
      return { success: false, message: 'Ticket not found.' };
    }

    const ticket = ticketSnapshot.data();
    const seatRef = ticket.seat_id ? db.collection('seats').doc(ticket.seat_id) : null;
    const seatSnapshot = seatRef ? await transaction.get(seatRef) : null;

    transaction.delete(ticketRef);
    if (seatSnapshot?.exists && seatSnapshot.data().status === 'BOOKED') {
      transaction.update(seatRef, {
        status: 'AVAILABLE',
        locked_by: null,
        lock_expiration: null,
      });
    }

    return { success: true, message: 'Ticket deleted and seat released.' };
  });

  if (outcome.success) await publishSystemState();
  return outcome;
}

async function SyncOfflineBatchProcedure() {
  return {
    success: false,
    status: 'OFFLINE_SYNC_DISABLED',
    message: 'Offline ticket validation is disabled. Tickets must be validated online.',
  };
}

module.exports = {
  CreateEventProcedure,
  UpdateEventProcedure,
  DeleteEventProcedure,
  CreateSeatProcedure,
  CreateSeatsBatchProcedure,
  ExpandEventSeatsProcedure,
  DeleteSeatProcedure,
  LockSeatProcedure,
  BookSeatProcedure,
  ValidateTicketProcedure,
  DeleteTicketProcedure,
  SyncOfflineBatchProcedure,
};
