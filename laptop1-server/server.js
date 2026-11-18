require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const rpcMethods = require('./controllers/rpcController');
const {
  initWebSocketHub,
  fetchSystemSnapshot,
  fetchPublicSnapshot,
} = require('./websocket/wsHub');
const { startLockReaper } = require('./middleware/lockReaper');
const { loginStaff, requireStaff, isValidStaffToken } = require('./middleware/staffAuth');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.set('trust proxy', 1);

app.get('/api/v1/health', (_req, res) => {
  res.status(200).json({ status: 'ONLINE', serverTime: Date.now() });
});

app.get('/api/v1/events', async (_req, res) => {
  try {
    const snapshot = await require('./config/database')
      .collection('events').orderBy('created_at', 'desc').get();
    const events = snapshot.docs.map((d) => {
      const data = d.data();
      return {
        event_id: d.id,
        name: data.name,
        description: data.description,
        venue: data.venue,
        date: data.date,
        image: data.image || null,
        created_at: data.created_at?.toDate?.().toISOString() || null,
      };
    });
    res.json({ events });
  } catch (error) {
    console.error('[Events Error]:', error);
    res.status(500).json({ error: 'Unable to load events.' });
  }
});

app.post('/api/v1/auth/login', loginStaff);

app.get('/api/v1/public/state', async (_req, res) => {
  try {
    res.json(await fetchPublicSnapshot());
  } catch (error) {
    console.error('[State Snapshot Error]:', error);
    res.status(500).json({ error: 'Unable to load current system state.' });
  }
});

app.get('/api/v1/state', requireStaff, async (_req, res) => {
  try {
    res.json(await fetchSystemSnapshot());
  } catch (error) {
    console.error('[State Snapshot Error]:', error);
    res.status(500).json({ error: 'Unable to load current system state.' });
  }
});

app.post('/api/v1/rpc', async (req, res) => {
  const request = req.body;
  const id = request && Object.prototype.hasOwnProperty.call(request, 'id')
    ? request.id
    : null;

  if (!request || request.jsonrpc !== '2.0' ||
      typeof request.method !== 'string' ||
      !Object.prototype.hasOwnProperty.call(rpcMethods, request.method)) {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32601, message: 'Procedure not found.' },
      id,
    });
  }
  if (request.params !== undefined &&
      (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))) {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'params must be an object.' },
      id,
    });
  }

  const publicProcedures = new Set(['LockSeatProcedure', 'BookSeatProcedure']);
  if (!publicProcedures.has(request.method) &&
      !isValidStaffToken((req.get('authorization') || '').replace(/^Bearer /, ''))) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Staff login required.' },
      id,
    });
  }

  try {
    const result = await rpcMethods[request.method](request.params || {});
    return res.json({ jsonrpc: '2.0', result, id });
  } catch (error) {
    console.error(`[RPC Error in ${request.method}]:`, error);
    const invalidParams = error instanceof TypeError || error instanceof RangeError;
    return res.status(invalidParams ? 400 : 500).json({
      jsonrpc: '2.0',
      error: invalidParams
        ? { code: -32602, message: error.message }
        : { code: -32603, message: 'Internal error.' },
      id,
    });
  }
});

app.post('/api/v1/sync/batch', requireStaff, async (req, res) => {
  const result = await rpcMethods.SyncOfflineBatchProcedure();
  res.status(409).json(result);
});

// ── Serve client apps ────────────────────────────────────────────────────────
const clientApps = [
  { port: 3002, route: '/ticketing', dir: '../laptop2-ticketing/build' },
  { port: 3003, route: '/validator', dir: '../laptop3-attendee/build' },
  { port: 3004, route: '/attendee', dir: '../laptop4-attendee/build' },
];
if (process.env.SERVE_CLIENTS_ON_MAIN_PORT === 'true') {
  for (const { route, dir } of clientApps) {
    const buildPath = path.resolve(__dirname, dir);
    if (!fs.existsSync(path.join(buildPath, 'index.html'))) {
      throw new Error(`Missing client build for ${route}: ${buildPath}`);
    }
    app.use(route, express.static(buildPath));
    app.get(`${route}/*`, (_req, res) => res.sendFile(path.join(buildPath, 'index.html')));
    app.get(route, (_req, res) => res.redirect(`${route}/`));
  }
  app.get('/', (_req, res) => res.redirect('/attendee/'));
} else {
  clientApps.forEach(({ port: clientPort, dir }) => {
    const buildPath = path.join(__dirname, dir);
    if (fs.existsSync(buildPath)) {
      const clientApp = express();
      clientApp.use(express.static(buildPath));
      clientApp.get('*', (_req, res) => res.sendFile(path.join(buildPath, 'index.html')));
      clientApp.listen(clientPort, '0.0.0.0', () =>
        console.log(`Client app served on port ${clientPort}`)
      );
    }
  });
}

const server = http.createServer(app);
initWebSocketHub(server);
startLockReaper();

const port = Number(process.env.PORT) || 5001;
server.listen(port, '0.0.0.0', () => {
  console.log(`EventMesh Master Server listening on port ${port}`);
  console.log(`JSON-RPC 2.0: http://0.0.0.0:${port}/api/v1/rpc`);
  console.log(`WebSocket: ws://0.0.0.0:${port}`);
});
