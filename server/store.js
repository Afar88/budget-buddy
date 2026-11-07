// Budget Buddy store: one small JSON document holding settings, members and the usage ledger.
//
// Two backends, picked from env:
//   redis - Upstash Redis over its REST API (what Vercel's free Upstash/KV marketplace
//           integration injects: KV_REST_API_URL + KV_REST_API_TOKEN, or
//           UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN). Needed on Vercel, where
//           the filesystem does not persist between requests.
//   file  - a local JSON file (DATA_FILE, default ./data/db.json). The fallback when no
//           Redis env vars are set: local dev, Render, any normal server.
// Good enough for a family or one classroom; swap for SQLite/Postgres if you outgrow it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');
const REDIS_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_KEY = process.env.REDIS_KEY || 'budget-buddy:db';
const backend = REDIS_URL && REDIS_TOKEN ? 'redis' : 'file';
const WRITE_LOCK_KEY = `${REDIS_KEY}:write-lock`;
const WRITE_LOCK_TTL_MS = 120_000;
const localLocks = new Set();

const EMPTY = { settings: { groupName: 'Our group' }, groups: [], members: [], ledger: [] };

// One shared object; load() refreshes its contents in place so every module holding it sees fresh data.
const db = structuredClone(EMPTY);
let fileLoaded = false;

function normalize(data) {
  data = data && typeof data === 'object' ? data : {};
  db.settings = data.settings || { groupName: 'Our group' };
  db.groups = data.groups || [];
  db.members = data.members || [];
  db.ledger = data.ledger || [];
  return db;
}

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Redis ${command[0]} failed: ${data.error || res.status}`);
  return data.result;
}

// Read the latest state. File mode reads once and then keeps it in memory (single process);
// Redis mode re-reads on every call, because serverless instances do not share memory.
async function load() {
  if (backend === 'redis') {
    const raw = await redis(['GET', REDIS_KEY]);
    return normalize(raw ? JSON.parse(raw) : structuredClone(EMPTY));
  }
  if (fileLoaded) return db;
  fileLoaded = true;
  try {
    return normalize(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch {
    return normalize(structuredClone(EMPTY));
  }
}

// A short distributed lease serializes read-modify-write API requests across Vercel instances.
// The owner token ensures one instance can never release another instance's lock.
async function acquireWriteLock() {
  const token = crypto.randomUUID();
  if (backend === 'redis') {
    const result = await redis(['SET', WRITE_LOCK_KEY, token, 'NX', 'PX', WRITE_LOCK_TTL_MS]);
    return result === 'OK' ? { token, key: WRITE_LOCK_KEY } : null;
  }
  if (localLocks.has('write')) return null;
  localLocks.add('write');
  return { token, key: 'local:write' };
}

async function releaseWriteLock(lock) {
  if (!lock) return;
  if (backend === 'redis') {
    await redis(['EVAL', "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, lock.key, lock.token]);
    return;
  }
  localLocks.delete('write');
}

// Atomic shared fixed-window counter for authentication throttling.
async function incrementRateLimit(key, windowMs) {
  if (backend !== 'redis') throw new Error('Shared rate limits require Redis');
  const redisKey = `${REDIS_KEY}:rate-limit:${key}`;
  const script = "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return {n, redis.call('PTTL', KEYS[1])}";
  const result = await redis(['EVAL', script, 1, redisKey, windowMs]);
  if (!Array.isArray(result) || result.length < 2) throw new Error('Redis returned an invalid rate-limit result');
  return { count: Number(result[0]), ttlMs: Number(result[1]) };
}

async function save() {
  // Keep the ledger bounded: only the last 8 weeks matter for weekly caps.
  const cutoff = Date.now() - 56 * 24 * 3600 * 1000;
  db.ledger = db.ledger.filter((e) => e.ts >= cutoff);
  const json = JSON.stringify(db, null, backend === 'redis' ? 0 : 2);
  if (backend === 'redis') {
    await redis(['SET', REDIS_KEY, json]);
    return;
  }
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, DATA_FILE);
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

// Short, kid-friendly join code: 6 characters, no look-alikes (0/O, 1/I/L).
function newJoinCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return code;
}

module.exports = { db, load, save, newId, newJoinCode, acquireWriteLock, releaseWriteLock, incrementRateLimit, DATA_FILE, backend };
