const { WebSocketServer, WebSocket } = require('ws');
const db = require('../config/database');
const { assignSeatLabels } = require('../utils/seatLabels');

let webSocketServer;
let cachedSnapshot = null;
let cacheTime = 0;
let broadcastTimer = null;
const CACHE_TTL = 3000; // reuse snapshot if fresher than 3s
const BROADCAST_DEBOUNCE = 500; // collapse rapid triggers into one broadcast

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return value;
}

async function fetchSystemSnapshot(alert = null) {
  const now = Date.now();

  // Return cached snapshot if fresh and no alert to attach
  if (!alert && cachedSnapshot && (now - cacheTime) < CACHE_TTL) {
    return cachedSnapshot;
  }

  const [eventSnapshot, seatSnapshot, ticketSnapshot, entrySnapshot] = await Promise.all([
    db.collection('events').orderBy('created_at', 'desc').get(),
    db.collection('seats').get(),
    db.collection('tickets').get(),
    db.collection('entry_logs').orderBy('scan_timestamp', 'desc').limit(25).get(),
  ]);

  const events = eventSnapshot.docs.map((d) => ({
    ...d.data(),
    event_id: d.id,
    date: serializeTimestamp(d.data().date),
    created_at: serializeTimestamp(d.data().created_at),
    image: undefined,
  }));

  const seats = assignSeatLabels(seatSnapshot.docs
    .map((d) => ({ ...d.data(), seat_id: d.id }))
  );

  const seatsById = new Map(seats.map((s) => [s.seat_id, s]));
  const eventsById = new Map(events.map((event) => [event.event_id, event]));

  const tickets = ticketSnapshot.docs.map((d) => {
    const t = d.data();
    const seat = seatsById.get(t.seat_id);
    const eventId = t.event_id || seat?.event_id || t.seat_id?.match(/^(.*)_(?:R\d+S\d+|S\d+)$/)?.[1];
    const event = eventsById.get(eventId);
    return {
      ...t,
      ticket_id: d.id,
      event_id: eventId ?? null,
      event_name: t.event_name || event?.name || 'Unknown event',
      seat_label: seat?.seat_label || t.seat_label || t.seat_id,
      row_number: seat?.row_number ?? null,
      seat_number: seat?.seat_number ?? null,
      created_at: serializeTimestamp(t.created_at),
      validated_at: serializeTimestamp(t.validated_at),
    };
  });

  const recentLogs = entrySnapshot.docs.map((d) => ({
    ...d.data(),
    log_id: d.id,
    scan_timestamp: serializeTimestamp(d.data().scan_timestamp),
  }));

  const seatsBooked = seats.filter((s) => s.status === 'BOOKED').length;

  const snapshot = {
    events,
    seats: seats.map((s) => ({ ...s, lock_expiration: serializeTimestamp(s.lock_expiration) })),
    tickets,
    metrics: {
      totalCapacity: seats.length,
      seatsBooked,
      totalCheckedIn: tickets.filter((t) => t.is_validated).length,
      remainingCapacity: Math.max(0, seats.length - seatsBooked),
    },
    recentLogs,
    alert,
    serverTime: new Date().toISOString(),
  };

  // Only cache if no alert (alerts are one-time)
  if (!alert) {
    cachedSnapshot = snapshot;
    cacheTime = now;
  }

  return snapshot;
}

async function fetchPublicSnapshot() {
  const snapshot = await fetchSystemSnapshot();
  return {
    events: snapshot.events,
    seats: snapshot.seats.map((seat) => ({
      seat_id: seat.seat_id,
      event_id: seat.event_id,
      seat_label: seat.seat_label,
      row_number: seat.row_number,
      seat_number: seat.seat_number,
      status: seat.status,
    })),
    serverTime: snapshot.serverTime,
  };
}

function invalidateCache() {
  cachedSnapshot = null;
  cacheTime = 0;
}

function initWebSocketHub(server) {
  if (webSocketServer) throw new Error('WebSocket hub already initialized');

  webSocketServer = new WebSocketServer({ server });
  webSocketServer.on('connection', async (socket) => {
    try {
      socket.send(JSON.stringify({ type: 'SYSTEM_STATE', state: await fetchPublicSnapshot() }));
    } catch (error) {
      console.error('[WebSocket Initial State Error]:', error);
      socket.close(1011, 'Unable to load current system state');
    }
  });

  return webSocketServer;
}

async function broadcastSystemState(alert = null) {
  if (!webSocketServer) return;

  // Invalidate cache so next fetch reads fresh data
  invalidateCache();

  // Debounce: if no alert, collapse rapid back-to-back calls into one broadcast
  if (!alert) {
    if (broadcastTimer) return; // already scheduled
    broadcastTimer = setTimeout(async () => {
      broadcastTimer = null;
      try {
        const message = JSON.stringify({ type: 'SYSTEM_STATE', state: await fetchPublicSnapshot() });
        for (const socket of webSocketServer.clients) {
          if (socket.readyState === WebSocket.OPEN) socket.send(message);
        }
      } catch (err) {
        console.error('[Broadcast Error]:', err);
      }
    }, BROADCAST_DEBOUNCE);
    return;
  }

  // Alerts broadcast immediately (no debounce)
  try {
    const message = JSON.stringify({ type: 'SYSTEM_STATE', state: await fetchPublicSnapshot() });
    for (const socket of webSocketServer.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  } catch (err) {
    console.error('[Broadcast Error]:', err);
  }
}

module.exports = {
  initWebSocketHub,
  fetchSystemSnapshot,
  fetchPublicSnapshot,
  broadcastSystemState,
};
