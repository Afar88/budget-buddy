// Minimal signed-cookie sessions (no extra dependencies).
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[auth] SESSION_SECRET not set: sessions reset on every restart.');
}

function sign(value) {
  const mac = crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
  return `${value}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const value = token.slice(0, i);
  const expected = sign(value);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

function setCookie(res, name, value, maxAgeSec = 60 * 60 * 24 * 30) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`
  );
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function checkPassword(given) {
  const real = process.env.ADMIN_PASSWORD || '';
  if (!real) return false;
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

// Passwords for self-signed-up grown-ups: scrypt with a per-account salt.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function checkHash(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(password || ''), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The admin cookie holds the group id: "admin:<groupId>". The original demo
// password signs in to the built-in "demo" group (plain "admin" means demo too).
function requireAdmin(req, res, next) {
  const v = verify(parseCookies(req.headers.cookie).bb_admin);
  if (v === 'admin') {
    req.groupId = 'demo';
    return next();
  }
  if (v && v.startsWith('admin:')) {
    req.groupId = v.slice(6);
    return next();
  }
  res.status(401).json({ error: 'Admin sign-in required' });
}

function memberIdFrom(req) {
  const v = verify(parseCookies(req.headers.cookie).bb_member);
  return v && v.startsWith('member:') ? v.slice(7) : null;
}

module.exports = { sign, verify, setCookie, clearCookie, checkPassword, hashPassword, checkHash, requireAdmin, memberIdFrom };
