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
const staffTokens = new Map();

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
      STAFF_PASSWORD: 'local-storage-test-password',
      SERVE_CLIENTS_ON_MAIN_PORT: 'true',
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

async function callRpc(port, method, params, staff = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (staff) headers.Authorization = `Bearer ${await getStaffToken(port)}`;
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload.result;
}

async function getStaffToken(port) {
  if (staffTokens.has(port)) return staffTokens.get(port);
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'local-storage-test-password' }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  staffTokens.set(port, payload.token);
  return payload.token;
}

async function fetchStaffState(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/state`, {
    headers: { Authorization: `Bearer ${await getStaffToken(port)}` },
  });
  return response;
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

test('seat labels restart at S1 for each event', () => {
  const labeled = assignSeatLabels([
    { seat_id: 'event-b_S2', event_id: 'event-b', seat_number: 2 },
    { seat_id: 'event-a_S2', event_id: 'event-a', seat_number: 2 },
    { seat_id: 'event-b_S1', event_id: 'event-b', seat_number: 1 },
    { seat_id: 'event-a_S1', event_id: 'event-a', seat_number: 1 },
  ]);

  assert.deepEqual(
    labeled.map((seat) => `${seat.event_id}:${seat.seat_label}`).sort(),
    ['event-a:S1', 'event-a:S2', 'event-b:S1', 'event-b:S2'],
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

  for (const route of ['/ticketing', '/validator', '/attendee']) {
    const appResponse = await fetch(`http://127.0.0.1:${port}${route}/`);
    assert.equal(appResponse.status, 200);
    const html = await appResponse.text();
    const scriptPath = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(scriptPath?.includes('/static/js/'), `${route} should include a JS bundle`);
    const mountedScriptPath = scriptPath.startsWith(`${route}/`)
      ? scriptPath
      : `${route}${scriptPath}`;
    const scriptResponse = await fetch(`http://127.0.0.1:${port}${mountedScriptPath}`);
    assert.equal(scriptResponse.status, 200);
  }

  const privateStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
  assert.equal(privateStateResponse.status, 401);
  const privateCreateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'CreateEventProcedure',
      params: { name: 'Unauthenticated event' },
      id: 1,
    }),
  });
  assert.equal(privateCreateResponse.status, 401);
  const publicStateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/public/state`);
  assert.equal(publicStateResponse.status, 200);
  assert.equal(Object.hasOwn(await publicStateResponse.json(), 'tickets'), false);

  const created = await callRpc(port, 'CreateEventProcedure', {
    name: 'Local storage test event',
    venue: 'Test venue',
    date: '2026-12-01',
    total_seats: 4,
  });
  assert.equal(created.success, true);
  assert.equal(created.created_count, 4);

  const eventsResponse = await fetch(`http://127.0.0.1:${port}/api/v1/events`);
  assert.equal(eventsResponse.status, 200);
  const events = await eventsResponse.json();
  assert.equal(events.events[0].event_id, created.event_id);

  const stateResponse = await fetchStaffState(port);
  assert.equal(stateResponse.status, 200);
  const createdState = await stateResponse.json();
  assert.equal(createdState.seats.length, 4);
  assert.deepEqual(
    createdState.seats.map((seat) => seat.seat_id).sort(),
    [1, 2, 3, 4].map((number) => `${created.event_id}_S${number}`),
  );
  assert.deepEqual(
    createdState.seats.map((seat) => seat.seat_label),
    ['S1', 'S2', 'S3', 'S4'],
  );

  const seatId = `${created.event_id}_S1`;
  const nodeId = 'NODE_LOCAL_TEST';
  const lock = await callRpc(port, 'LockSeatProcedure', { seat_id: seatId, node_id: nodeId }, false);
  assert.equal(lock.success, true);
  const conflictingLock = await callRpc(port, 'LockSeatProcedure', {
    seat_id: seatId,
    node_id: 'ANOTHER_NODE',
  });
  assert.equal(conflictingLock.success, false);

  const booking = await callRpc(port, 'BookSeatProcedure', {
    seat_id: seatId,
    node_id: nodeId,
    attendee_name: 'Local Test Attendee',
    attendee_address: '1 Test Street',
    attendee_phone: '555-0100',
    attendee_email: 'attendee@example.test',
  }, false);
  assert.equal(booking.success, true);
  assert.equal(booking.ticket.seat_label, 'S1');

  const bookedStateResponse = await fetchStaffState(port);
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
  const expandedStateResponse = await fetchStaffState(port);
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
  assert.equal(websocketState.state.seats.length, 9);
  assert.equal(Object.hasOwn(websocketState.state, 'tickets'), false);
  const validatedState = await fetchStaffState(port);
  assert.equal((await validatedState.json()).tickets[0].is_validated, true);

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
  const updatedStateResponse = await fetchStaffState(port);
  const updatedState = await updatedStateResponse.json();
  assert.equal(updatedState.events[0].name, 'Updated local storage test event');
  assert.equal(updatedState.seats.length, 12);
  assert.equal(updatedState.seats.find((seat) => seat.seat_id === `${created.event_id}_S12`).seat_label, 'S12');
  assert.equal(updatedState.seats.find((seat) => seat.seat_id === seatId).status, 'BOOKED');

  const deletion = await callRpc(port, 'DeleteTicketProcedure', {
    ticket_id: booking.ticket.ticket_id,
  });
  assert.equal(deletion.success, true);
  const deletedStateResponse = await fetchStaffState(port);
  const deletedState = await deletedStateResponse.json();
  assert.equal(deletedState.tickets.length, 0);
  assert.equal(deletedState.seats.find((seat) => seat.seat_id === seatId).status, 'AVAILABLE');

  await stopServer(child);
  port = await getAvailablePort();
  staffTokens.delete(port);
  child = startServer(port, dataDirectory);
  await waitForServer(child, port);

  const persistedEvents = await fetch(`http://127.0.0.1:${port}/api/v1/events`);
  assert.equal(persistedEvents.status, 200);
  const persistedEvent = (await persistedEvents.json()).events[0];
  assert.equal(persistedEvent.event_id, created.event_id);
  assert.equal(persistedEvent.name, 'Updated local storage test event');

  const legacyEvent = await callRpc(port, 'CreateEventProcedure', {
    name: 'Legacy layout event',
  });
  const legacySeatsCreated = await callRpc(port, 'CreateSeatsBatchProcedure', {
    event_id: legacyEvent.event_id,
    rows: 2,
    cols: 5,
  });
  assert.equal(legacySeatsCreated.success, true);

  const legacyStateResponse = await fetchStaffState(port);
  const legacyState = await legacyStateResponse.json();
  const legacySeats = legacyState.seats.filter((seat) => seat.event_id === legacyEvent.event_id);
  assert.deepEqual(legacySeats.map((seat) => seat.seat_label), [
    'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10',
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
  assert.equal(legacyBooking.ticket.seat_label, 'S6');

  const legacyTicketStateResponse = await fetchStaffState(port);
  const legacyTicketState = await legacyTicketStateResponse.json();
  assert.equal(
    legacyTicketState.tickets.find((ticket) => ticket.ticket_id === legacyBooking.ticket.ticket_id).seat_label,
    'S6',
  );
});
