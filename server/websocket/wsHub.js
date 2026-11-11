const { WebSocketServer, WebSocket } = require('ws');
const db = require('../config/database');

let webSocketServer;

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return value;
}

async function fetchSystemSnapshot(alert = null) {
  const [seatSnapshot, ticketSnapshot, entrySnapshot] = await Promise.all([
    db.collection('seats').get(),
    db.collection('tickets').get(),
    db.collection('entry_logs')
      .orderBy('scan_timestamp', 'desc')
      .limit(25)
      .get(),
  ]);

  const seats = seatSnapshot.docs
    .map((document) => ({ ...document.data(), seat_id: document.id }))
    .sort((a, b) => a.row_number - b.row_number || a.seat_number - b.seat_number);
  const seatsById = new Map(seats.map((seat) => [seat.seat_id, seat]));
  const tickets = ticketSnapshot.docs.map((document) => {
    const ticket = document.data();
    const seat = seatsById.get(ticket.seat_id);
    return {
      ...ticket,
      ticket_id: document.id,
      row_number: seat?.row_number ?? null,
      seat_number: seat?.seat_number ?? null,
      created_at: serializeTimestamp(ticket.created_at),
      validated_at: serializeTimestamp(ticket.validated_at),
    };
  });
  const recentLogs = entrySnapshot.docs.map((document) => {
    const log = document.data();
    return {
      ...log,
      log_id: document.id,
      scan_timestamp: serializeTimestamp(log.scan_timestamp),
    };
  });

  const totalCapacity = seats.length;
  const seatsBooked = seats.filter((seat) => seat.status === 'BOOKED').length;
  const totalCheckedIn = tickets.filter((ticket) => ticket.is_validated).length;

  return {
    seats: seats.map((seat) => ({
      ...seat,
      lock_expiration: serializeTimestamp(seat.lock_expiration),
    })),
    tickets,
    metrics: {
      totalCapacity,
      seatsBooked,
      totalCheckedIn,
      remainingCapacity: Math.max(0, totalCapacity - seatsBooked),
    },
    recentLogs,
    alert,
    serverTime: new Date().toISOString(),
  };
}

function initWebSocketHub(server) {
  if (webSocketServer) {
    throw new Error('WebSocket hub has already been initialized');
  }

  webSocketServer = new WebSocketServer({ server });
  webSocketServer.on('connection', async (socket) => {
    try {
      socket.send(JSON.stringify({
        type: 'SYSTEM_STATE',
        state: await fetchSystemSnapshot(),
      }));
    } catch (error) {
      console.error('[WebSocket Initial State Error]:', error);
      socket.close(1011, 'Unable to load current system state');
    }
  });

  return webSocketServer;
}

async function broadcastSystemState(alert = null) {
  if (!webSocketServer) return;

  const message = JSON.stringify({
    type: 'SYSTEM_STATE',
    state: await fetchSystemSnapshot(alert),
  });
  for (const socket of webSocketServer.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

module.exports = {
  initWebSocketHub,
  fetchSystemSnapshot,
  broadcastSystemState,
};
