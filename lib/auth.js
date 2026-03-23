const crypto = require('crypto');
const { readPath, writePath } = require('./firebase');

const USERS_PATH = 'mercadopago-bridge/users';
const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-auth-secret-change-me';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sign(data) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, password_hash: hashPassword(password, salt) };
}

function verifyPassword(password, user) {
  const expected = Buffer.from(user.password_hash, 'hex');
  const actual = Buffer.from(hashPassword(password, user.salt), 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function createToken(payload) {
  const body = {
    ...payload,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = base64url(JSON.stringify(body));
  return `${encoded}.${sign(encoded)}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  if (sign(encoded) !== signature) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function sanitizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function userIdFromEmail(email) {
  return crypto.createHash('sha256').update(sanitizeEmail(email)).digest('hex').slice(0, 24);
}

async function readUserByEmail(email) {
  const safeEmail = sanitizeEmail(email);
  if (!safeEmail) return null;
  const userId = userIdFromEmail(safeEmail);
  const user = await readPath(`${USERS_PATH}/${userId}`);
  return user ? { id: userId, ...user } : null;
}

async function createUser(email, password) {
  const safeEmail = sanitizeEmail(email);
  if (!isValidEmail(safeEmail)) {
    throw new Error('Email invalido');
  }
  if (!password || password.length < 8) {
    throw new Error('La contrasena debe tener al menos 8 caracteres');
  }
  const existing = await readUserByEmail(safeEmail);
  if (existing) {
    throw new Error('Ya existe una cuenta con este email');
  }
  const userId = userIdFromEmail(safeEmail);
  const passwordRecord = createPasswordRecord(password);
  const now = Date.now();
  const user = {
    email: safeEmail,
    created_at: now,
    last_login_at: now,
    ...passwordRecord,
  };
  await writePath(`${USERS_PATH}/${userId}`, user);
  return { id: userId, email: safeEmail, created_at: now, last_login_at: now };
}

async function updateLastLogin(userId) {
  const user = await readPath(`${USERS_PATH}/${userId}`);
  if (!user) return;
  await writePath(`${USERS_PATH}/${userId}`, {
    ...user,
    last_login_at: Date.now(),
  });
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

function authFromRequest(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return verifyToken(token);
}

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isAdmin(email) {
  return adminEmails().includes(sanitizeEmail(email));
}

module.exports = {
  USERS_PATH,
  authFromRequest,
  createToken,
  createUser,
  isAdmin,
  isValidEmail,
  publicUser,
  readUserByEmail,
  sanitizeEmail,
  updateLastLogin,
  verifyPassword,
  verifyToken,
};
