// Tiny JSON-file store. Good enough for a family or one classroom;
// swap for SQLite/Postgres if you outgrow it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');

const EMPTY = { settings: { groupName: 'Our group' }, members: [], ledger: [] };

let db = null;

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    db = structuredClone(EMPTY);
  }
  db.settings ||= { groupName: 'Our group' };
  db.members ||= [];
  db.ledger ||= [];
  return db;
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
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

module.exports = { load, save, newId, newJoinCode, DATA_FILE };
