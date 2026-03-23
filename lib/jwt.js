const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || process.env.AUTH_SECRET || 'dev-jwt-secret-change-me';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeJson(value) {
  return base64url(JSON.stringify(value));
}

function signSegment(segment) {
  return crypto.createHmac('sha256', JWT_SECRET).update(segment).digest('base64url');
}

function createJwt(payload, expiresInSeconds = 60 * 60 * 12) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    iat: now,
    exp: now + expiresInSeconds,
    ...payload,
  };

  const encodedHeader = encodeJson(header);
  const encodedBody = encodeJson(body);
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const signature = signSegment(signingInput);
  return `${signingInput}.${signature}`;
}

function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedBody, signature] = parts;
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const expected = signSegment(signingInput);
  if (expected !== signature) return null;

  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(encodedBody, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  createJwt,
  verifyJwt,
};
