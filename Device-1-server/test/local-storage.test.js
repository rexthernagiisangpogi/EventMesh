const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const WebSocket = require('ws');
const { assignSeatLabels } = require('../utils/seatLabels');

const serverDirectory = path.resolve(__dirname, '..');

async function getAvailablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => (
    error ? reject(error) : resolve()
  )));
  return port;
}

function startServer(port, dataDirectory) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      EVENTMESH_DATA_DIR: dataDirectory,
      HMAC_SECRET: 'local-storage-test-secret',
      NODE_ENV: 'test',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.output = () => output;
  return child;
}

async function waitForServer(child, port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited during startup:\n${child.output()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start in time:\n${child.output()}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

async function callRpc(port, method, params) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload.result;
}

async function openWebSocket(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    const message = await new Promise((resolve, reject) => {
      socket.once('message', (data) => resolve(JSON.parse(data.toString())));
      socket.once('error', reject);
      setTimeout(() => reject(new Error('WebSocket initial state timed out')), 5000).unref();
    });
    return message;
  } finally {
    socket.close();
  }
}

test('seat labels restart by type for each event', () => {
  const labeled = assignSeatLabels([
    { seat_id: 'event-b_VIP2', event_id: 'event-b', seat_number: 2, seat_type: 'VIP' },
    { seat_id: 'event-a_S2', event_id: 'event-a', seat_number: 2 },
    { seat_id: 'event-b_S2', event_id: 'event-b', seat_number: 2 },
    { seat_id: 'event-b_S1', event_id: 'event-b', seat_number: 1 },
    { seat_id: 'event-b_VIP1', event_id: 'event-b', seat_number: 1, seat_type: 'VIP' },
    { seat_id: 'event-a_S1', event_id: 'event-a', seat_number: 1 },
  ]);

  assert.deepEqual(
    labeled.map((seat) => `${seat.event_id}:${seat.seat_label}`).sort(),
    ['event-a:R1', 'event-a:R2', 'event-b:R1', 'event-b:R2', 'event-b:V1', 'event-b:V2'],
  );
});

test('local database supports event creation, ticketing, validation, and persistence', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventmesh-local-db-'));
  let port = await getAvailablePort();
  let child = startServer(port, dataDirectory);
  t.after(async () => {
    await stopServer(child);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });
  await waitForServer(child, port);

  const created = await callRpc(port, 'CreateEventProcedure', {
    name: 'Local storage test event',
    venue: 'Test venue',
    date: '2026-12-01',
    stage_type: 'Main Stage',
    seating_layout: 'ARENA',
    total_seats: 4,
  });
  assert.equal(created.success, true);
  assert.equal(created.created_count, 4);

  const eventsResponse = await fetch(`http://127.0.0.1:${port}/api/v1/events`);
  assert.equal(eventsResponse.status, 200);
  const events = await eventsResponse.json();
  assert.equal(events.events[0].event_id, created.event_id);
  assert.equal(events.events[0].stage_type, 'Main Stage');
  assert.equal(events.events[0].seating_layout, 'ARENA');

  const stateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  assert.equal(stateResponse.status, 200);
  const createdState = await stateResponse.json();
  assert.equal(createdState.seats.length, 4);
  assert.deepEqual(
    createdState.seats.map((seat) => seat.seat_id).sort(),
    [1, 2, 3, 4].map((number) => `${created.event_id}_S${number}`),
  );
  assert.deepEqual(
    createdState.seats.map((seat) => seat.seat_label),
    ['R1', 'R2', 'R3', 'R4'],
  );

  const seatId = `${created.event_id}_S1`;
  const nodeId = 'NODE_LOCAL_TEST';
  const lock = await callRpc(port, 'LockSeatProcedure', { seat_id: seatId, node_id: nodeId });
  assert.equal(lock.success, true);
  const conflictingLock = await callRpc(port, 'LockSeatProcedure', {
    seat_id: seatId,
    node_id: 'ANOTHER_NODE',
  });
  assert.equal(conflictingLock.success, false);

  const conflictingRelease = await callRpc(port, 'ReleaseSeatProcedure', {
    seat_id: seatId,
    node_id: 'ANOTHER_NODE',
  });
  assert.equal(conflictingRelease.success, false);

  const release = await callRpc(port, 'ReleaseSeatProcedure', { seat_id: seatId, node_id: nodeId });
  assert.equal(release.success, true);
  const releasedStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  const releasedState = await releasedStateResponse.json();
  assert.equal(releasedState.seats.find((seat) => seat.seat_id === seatId).status, 'AVAILABLE');
  const repeatedRelease = await callRpc(port, 'ReleaseSeatProcedure', {
    seat_id: seatId,
    node_id: nodeId,
  });
  assert.equal(repeatedRelease.success, true);

  const relock = await callRpc(port, 'LockSeatProcedure', { seat_id: seatId, node_id: nodeId });
  assert.equal(relock.success, true);

  const booking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: seatId,
    node_id: nodeId,
    attendee_name: 'Local Test Attendee',
    attendee_address: '1 Test Street',
    attendee_phone: '555-0100',
    attendee_email: 'attendee@example.test',
  });
  assert.equal(booking.success, true);
  assert.equal(booking.ticket.seat_label, 'R1');

  const bookedStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  const bookedState = await bookedStateResponse.json();
  assert.equal(bookedState.tickets[0].event_id, created.event_id);
  assert.equal(bookedState.tickets[0].event_name, 'Local storage test event');
  assert.equal(bookedState.tickets[0].attendee_address, '1 Test Street');

  const expandedSeats = await callRpc(port, 'ExpandEventSeatsProcedure', {
    event_id: created.event_id,
    total_seats: 9,
  });
  assert.equal(expandedSeats.success, true);
  assert.equal(expandedSeats.created_count, 5);
  const expandedStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  const expandedState = await expandedStateResponse.json();
  assert.equal(expandedState.seats.length, 9);
  assert.equal(expandedState.seats.find((seat) => seat.seat_id === seatId).status, 'BOOKED');

  const repeatedExpansion = await callRpc(port, 'ExpandEventSeatsProcedure', {
    event_id: created.event_id,
    total_seats: 9,
  });
  assert.equal(repeatedExpansion.success, true);
  assert.equal(repeatedExpansion.created_count, 0);

  const validation = await callRpc(port, 'ValidateTicketProcedure', {
    ticket_hash: booking.ticket.qr_hash,
    terminal_id: 'LOCAL_TEST_GATE',
  });
  assert.equal(validation.success, true);

  const websocketState = await openWebSocket(port);
  assert.equal(websocketState.type, 'SYSTEM_STATE');
  assert.equal(websocketState.state.tickets[0].is_validated, true);
  assert.equal(websocketState.state.tickets[0].event_name, 'Local storage test event');

  const updated = await callRpc(port, 'UpdateEventProcedure', {
    event_id: created.event_id,
    name: 'Updated local storage test event',
    description: 'Updated description',
    venue: 'Updated venue',
    date: '2026-12-02',
    image: '',
    total_seats: 12,
  });
  assert.equal(updated.success, true);
  assert.equal(updated.created_count, 3);
  const updatedStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  const updatedState = await updatedStateResponse.json();
  assert.equal(updatedState.events[0].name, 'Updated local storage test event');
  assert.equal(updatedState.events[0].seating_layout, 'ARENA');
  assert.equal(updatedState.seats.length, 12);
  assert.equal(updatedState.seats.find((seat) => seat.seat_id === `${created.event_id}_S12`).seat_label, 'R12');
  assert.equal(updatedState.seats.find((seat) => seat.seat_id === seatId).status, 'BOOKED');

  const deletion = await callRpc(port, 'DeleteTicketProcedure', {
    ticket_id: booking.ticket.ticket_id,
  });
  assert.equal(deletion.success, true);
  const deletedStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  const deletedState = await deletedStateResponse.json();
  assert.equal(deletedState.tickets.length, 0);
  assert.equal(deletedState.seats.find((seat) => seat.seat_id === seatId).status, 'AVAILABLE');

  const paidEvent = await callRpc(port, 'CreateEventProcedure', {
    name: 'Demo payment event',
    regular_seats: 1,
    vip_seats: 1,
    payment_required: true,
    regular_ticket_price: 250,
    vip_ticket_price: 500,
    payment_methods: ['gcash', 'maya'],
  });
  assert.equal(paidEvent.success, true);
  const defaultLayoutEvents = await fetch(`http://127.0.0.1:${port}/api/v1/events`);
  const defaultLayoutEvent = (await defaultLayoutEvents.json()).events.find((event) => (
    event.event_id === paidEvent.event_id
  ));
  assert.equal(defaultLayoutEvent.seating_layout, 'TRADITIONAL_THEATER');
  const paidEventUpdate = await callRpc(port, 'UpdateEventProcedure', {
    event_id: paidEvent.event_id,
    name: 'Updated demo payment event',
    payment_required: true,
    regular_ticket_price: 325.5,
    vip_ticket_price: 700,
    payment_methods: ['maya'],
  });
  assert.equal(paidEventUpdate.success, true);

  const paidSeatId = `${paidEvent.event_id}_REG1`;
  const paidSeatLock = await callRpc(port, 'LockSeatProcedure', {
    seat_id: paidSeatId,
    node_id: nodeId,
  });
  assert.equal(paidSeatLock.success, true);
  const unpaidBooking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: paidSeatId,
    node_id: nodeId,
    attendee_name: 'Unpaid Demo Attendee',
  });
  assert.equal(unpaidBooking.success, false);
  const wrongAmountBooking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: paidSeatId,
    node_id: nodeId,
    attendee_name: 'Wrong Amount Demo Attendee',
    payment_method: 'maya',
    payment_account: 'demo-wallet-1234',
    payment_amount: 325,
  });
  assert.equal(wrongAmountBooking.success, false);
  const wrongWalletBooking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: paidSeatId,
    node_id: nodeId,
    attendee_name: 'Wrong Wallet Demo Attendee',
    payment_method: 'gcash',
    payment_account: 'demo-wallet-1234',
    payment_amount: 325.5,
  });
  assert.equal(wrongWalletBooking.success, false);
  const missingAccountBooking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: paidSeatId,
    node_id: nodeId,
    attendee_name: 'Missing Account Demo Attendee',
    payment_method: 'maya',
    payment_amount: 325.5,
  });
  assert.equal(missingAccountBooking.success, false);
  const paidBooking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: paidSeatId,
    node_id: nodeId,
    attendee_name: 'Demo Payment Attendee',
    payment_method: 'maya',
    payment_account: 'demo-wallet-1234',
    payment_amount: 325.5,
  });
  assert.equal(paidBooking.success, true);
  assert.equal(paidBooking.ticket.payment_status, 'SIMULATED_PAID');
  assert.equal(paidBooking.ticket.payment_method, 'maya');
  assert.equal(paidBooking.ticket.payment_amount, 325.5);
  assert.equal(Object.hasOwn(paidBooking.ticket, 'payment_account'), false);
  const paidTicketsResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  const paidTicketsState = await paidTicketsResponse.json();
  const storedPaidTicket = paidTicketsState.tickets.find((ticket) => (
    ticket.ticket_id === paidBooking.ticket.ticket_id
  ));
  assert.equal(storedPaidTicket.payment_account, undefined);

  const paidVipSeatId = `${paidEvent.event_id}_VIP1`;
  const paidVipSeatLock = await callRpc(port, 'LockSeatProcedure', {
    seat_id: paidVipSeatId,
    node_id: nodeId,
  });
  assert.equal(paidVipSeatLock.success, true);
  const wrongTierPriceBooking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: paidVipSeatId,
    node_id: nodeId,
    attendee_name: 'Wrong VIP Tier Price Attendee',
    payment_method: 'maya',
    payment_account: 'demo-wallet-1234',
    payment_amount: 325.5,
  });
  assert.equal(wrongTierPriceBooking.success, false);
  const paidVipBooking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: paidVipSeatId,
    node_id: nodeId,
    attendee_name: 'VIP Demo Payment Attendee',
    payment_method: 'maya',
    payment_account: 'demo-wallet-1234',
    payment_amount: 700,
  });
  assert.equal(paidVipBooking.success, true);
  assert.equal(paidVipBooking.ticket.payment_amount, 700);

  const legacyPaidEvent = await callRpc(port, 'CreateEventProcedure', {
    name: 'Legacy payment event',
    total_seats: 1,
    payment_required: true,
    ticket_price: 85,
    payment_methods: ['maya'],
  });
  const legacyPaidUpdate = await callRpc(port, 'UpdateEventProcedure', {
    event_id: legacyPaidEvent.event_id,
    name: 'Updated legacy payment event',
    payment_required: true,
    ticket_price: 95,
    payment_methods: ['maya'],
  });
  assert.equal(legacyPaidUpdate.success, true);
  const legacyPaidSeatId = `${legacyPaidEvent.event_id}_S1`;
  const legacyPaidSeatLock = await callRpc(port, 'LockSeatProcedure', {
    seat_id: legacyPaidSeatId,
    node_id: nodeId,
  });
  assert.equal(legacyPaidSeatLock.success, true);
  const legacyPaidBooking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: legacyPaidSeatId,
    node_id: nodeId,
    attendee_name: 'Legacy Demo Payment Attendee',
    payment_method: 'maya',
    payment_account: 'demo-wallet-1234',
    payment_amount: 95,
  });
  assert.equal(legacyPaidBooking.success, true);
  assert.equal(legacyPaidBooking.ticket.payment_amount, 95);

  await stopServer(child);
  port = await getAvailablePort();
  child = startServer(port, dataDirectory);
  await waitForServer(child, port);

  const persistedEvents = await fetch(`http://127.0.0.1:${port}/api/v1/events`);
  assert.equal(persistedEvents.status, 200);
  const persistedEventsData = await persistedEvents.json();
  const persistedEvent = persistedEventsData.events.find((event) => (
    event.event_id === created.event_id
  ));
  assert.equal(persistedEvent.event_id, created.event_id);
  assert.equal(persistedEvent.name, 'Updated local storage test event');
  assert.equal(persistedEvent.stage_type, 'Main Stage');
  assert.equal(persistedEvent.seating_layout, 'ARENA');
  const persistedPaidEvent = persistedEventsData.events.find((event) => (
    event.event_id === paidEvent.event_id
  ));
  assert.equal(persistedPaidEvent.payment_required, true);
  assert.equal(persistedPaidEvent.ticket_price, 325.5);
  assert.equal(persistedPaidEvent.regular_ticket_price, 325.5);
  assert.equal(persistedPaidEvent.vip_ticket_price, 700);
  assert.deepEqual(persistedPaidEvent.payment_methods, ['maya']);
  const persistedLegacyPaidEvent = persistedEventsData.events.find((event) => (
    event.event_id === legacyPaidEvent.event_id
  ));
  assert.equal(persistedLegacyPaidEvent.ticket_price, 95);
  assert.equal(persistedLegacyPaidEvent.regular_ticket_price, 95);
  assert.equal(persistedLegacyPaidEvent.vip_ticket_price, 95);

  const legacyEvent = await callRpc(port, 'CreateEventProcedure', {
    name: 'Legacy layout event',
  });
  const legacySeatsCreated = await callRpc(port, 'CreateSeatsBatchProcedure', {
    event_id: legacyEvent.event_id,
    rows: 2,
    cols: 5,
  });
  assert.equal(legacySeatsCreated.success, true);

  const legacyStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  const legacyState = await legacyStateResponse.json();
  const legacySeats = legacyState.seats.filter((seat) => seat.event_id === legacyEvent.event_id);
  assert.deepEqual(legacySeats.map((seat) => seat.seat_label), [
    'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10',
  ]);

  const legacySeatId = `${legacyEvent.event_id}_R2S1`;
  const legacyLock = await callRpc(port, 'LockSeatProcedure', {
    seat_id: legacySeatId,
    node_id: nodeId,
  });
  assert.equal(legacyLock.success, true);
  const legacyBooking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: legacySeatId,
    node_id: nodeId,
    attendee_name: 'Legacy Layout Attendee',
  });
  assert.equal(legacyBooking.ticket.seat_label, 'R6');

  const legacyTicketStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  const legacyTicketState = await legacyTicketStateResponse.json();
  assert.equal(
    legacyTicketState.tickets.find((ticket) => ticket.ticket_id === legacyBooking.ticket.ticket_id).seat_label,
    'R6',
  );
});

test('VIP seats are labeled separately and preserved when seat counts expand', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventmesh-vip-seats-'));
  const port = await getAvailablePort();
  const child = startServer(port, dataDirectory);
  t.after(async () => {
    await stopServer(child);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });
  await waitForServer(child, port);

  const created = await callRpc(port, 'CreateEventProcedure', {
    name: 'VIP test event',
    regular_seats: 2,
    vip_seats: 2,
  });
  assert.equal(created.created_count, 4);

  const initialStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  const initialState = await initialStateResponse.json();
  const initialSeats = initialState.seats.filter((seat) => seat.event_id === created.event_id);
  assert.deepEqual(initialSeats.map((seat) => seat.seat_label), ['R1', 'R2', 'V1', 'V2']);
  assert.deepEqual(initialSeats.map((seat) => seat.seat_type), ['REGULAR', 'REGULAR', 'VIP', 'VIP']);

  const updated = await callRpc(port, 'UpdateEventProcedure', {
    event_id: created.event_id,
    name: 'VIP test event',
    regular_seats: 3,
    vip_seats: 3,
  });
  assert.equal(updated.created_count, 2);

  const updatedStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  const updatedState = await updatedStateResponse.json();
  const updatedSeats = updatedState.seats.filter((seat) => seat.event_id === created.event_id);
  assert.deepEqual(updatedSeats.map((seat) => seat.seat_label), ['R1', 'R2', 'R3', 'V1', 'V2', 'V3']);
});
