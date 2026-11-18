const crypto = require('crypto');

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const loginAttempts = new Map();

if (!process.env.HMAC_SECRET) {
  throw new Error('HMAC_SECRET must be configured before starting the server.');
}
if (!process.env.STAFF_PASSWORD) {
  throw new Error('STAFF_PASSWORD must be configured before starting the server.');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(payload) {
  return crypto
    .createHmac('sha256', process.env.HMAC_SECRET)
    .update(payload)
    .digest('base64url');
}

function createStaffToken() {
  const payload = Buffer.from(JSON.stringify({
    role: 'staff',
    expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function isValidStaffToken(token) {
  if (typeof token !== 'string') return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  if (!safeEqual(signature, sign(payload))) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'staff' &&
      Number.isInteger(data.expiresAt) &&
      data.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function getBearerToken(request) {
  const authorization = request.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

function requireStaff(request, response, next) {
  if (isValidStaffToken(getBearerToken(request))) return next();
  return response.status(401).json({ error: 'Staff login required.' });
}

function loginStaff(request, response) {
  const key = request.ip || request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = loginAttempts.get(key);
  const attempts = current && current.expiresAt > now ? current.count : 0;
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    return response.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  loginAttempts.set(key, { count: attempts + 1, expiresAt: now + LOGIN_WINDOW_MS });
  const configuredPassword = process.env.STAFF_PASSWORD || '';
  const suppliedPassword = typeof request.body?.password === 'string'
    ? request.body.password
    : '';
  if (!configuredPassword || !safeEqual(suppliedPassword, configuredPassword)) {
    return response.status(401).json({ error: 'Incorrect staff password.' });
  }

  loginAttempts.delete(key);
  return response.json({ token: createStaffToken(), expires_in: TOKEN_TTL_SECONDS });
}

module.exports = { isValidStaffToken, loginStaff, requireStaff };
