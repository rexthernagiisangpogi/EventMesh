const crypto = require('crypto');

function getSecret() {
  const secret = process.env.HMAC_SECRET;
  if (!secret) {
    throw new Error('HMAC_SECRET must be configured on the server');
  }
  return secret;
}

function generateTicketSignature(ticketId, seatId) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(`${ticketId}:${seatId}`)
    .digest('hex');
}

function verifyTicketSignature(ticketId, seatId, signature) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = Buffer.from(generateTicketSignature(ticketId, seatId), 'hex');
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length &&
    crypto.timingSafeEqual(received, expected);
}

module.exports = {
  generateTicketSignature,
  verifyTicketSignature,
};
