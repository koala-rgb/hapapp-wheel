'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'harvest.sqlite');
const MAX_BODY_BYTES = 1024 * 1024;
const HISTORY_LIMIT = 20;
const DEFAULT_CHOICES = ['Coffee', 'Tea', 'Tacos', 'Sushi', 'Pizza', 'Burgers', 'Pasta', 'Surprise me'];

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS choices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position INTEGER NOT NULL,
    label TEXT NOT NULL CHECK(length(label) <= 140)
  );
  CREATE INDEX IF NOT EXISTS choices_position_idx ON choices(position, id);
  CREATE TABLE IF NOT EXISTS recent_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    chosen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS recent_results_id_idx ON recent_results(id DESC);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function readSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function writeSetting(key, value) {
  db.prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

function getChoices() {
  return db.prepare('SELECT id, position, label FROM choices ORDER BY position, id').all();
}

function insertChoices(labels) {
  db.exec('DELETE FROM choices');
  const insert = db.prepare('INSERT INTO choices(position, label) VALUES(?, ?)');
  labels.forEach((label, position) => insert.run(position, label));
}

function getHistory() {
  return db.prepare('SELECT label, chosen_at AS chosenAt FROM recent_results ORDER BY id DESC LIMIT ?').all(HISTORY_LIMIT);
}

function publicState() {
  return {
    choices: getChoices().map((row) => row.label),
    history: getHistory(),
    settings: { removeWinnerAfterSpin: readSetting('removeWinnerAfterSpin', 'false') === 'true' }
  };
}

if (getChoices().length === 0) {
  insertChoices(DEFAULT_CHOICES);
}
if (readSetting('removeWinnerAfterSpin') === null) {
  writeSetting('removeWinnerAfterSpin', 'false');
}

function json(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function error(res, statusCode, message) {
  json(res, statusCode, { error: message });
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error('Request body is too large.');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const err = new Error('Request body must be valid JSON.');
    err.statusCode = 400;
    throw err;
  }
}

function validateChoices(input) {
  if (!Array.isArray(input)) throw new Error('Choices must be sent as a list.');
  const labels = input.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (labels.length < 1) throw new Error('Add at least one choice before saving.');
  if (labels.length > 100) throw new Error('Please keep the list to 100 choices or fewer.');
  if (labels.some((label) => label.length > 140)) throw new Error('Each choice must be 140 characters or fewer.');
  return labels;
}

function compactPositions() {
  const rows = getChoices();
  const update = db.prepare('UPDATE choices SET position = ? WHERE id = ?');
  rows.forEach((row, position) => update.run(position, row.id));
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return json(res, 200, publicState());
  }

  if (req.method === 'PUT' && url.pathname === '/api/choices') {
    const body = await readJson(req);
    const labels = validateChoices(body.choices);
    db.exec('BEGIN IMMEDIATE');
    try {
      insertChoices(labels);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return json(res, 200, publicState());
  }

  if (req.method === 'POST' && url.pathname === '/api/choices/reset') {
    db.exec('BEGIN IMMEDIATE');
    try {
      insertChoices(DEFAULT_CHOICES);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return json(res, 200, publicState());
  }

  if (req.method === 'POST' && url.pathname === '/api/shuffle') {
    const rows = getChoices();
    if (rows.length < 2) return error(res, 400, 'Add at least two choices to shuffle.');
    const labels = shuffle(rows.map((row) => row.label));
    db.exec('BEGIN IMMEDIATE');
    try {
      insertChoices(labels);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return json(res, 200, publicState());
  }

  if (req.method === 'POST' && url.pathname === '/api/spin') {
    const body = await readJson(req);
    const removeWinner = Boolean(body.removeWinnerAfterSpin);
    db.exec('BEGIN IMMEDIATE');
    let spinResult;
    try {
      const rows = getChoices();
      if (!rows.length) {
        db.exec('ROLLBACK');
        return error(res, 400, 'Add at least one choice before spinning.');
      }
      const chosenIndex = randomInt(rows.length);
      const chosen = rows[chosenIndex];
      const chosenAt = new Date().toISOString();
      db.prepare('INSERT INTO recent_results(label, chosen_at) VALUES(?, ?)').run(chosen.label, chosenAt);
      db.prepare(`DELETE FROM recent_results WHERE id NOT IN
        (SELECT id FROM recent_results ORDER BY id DESC LIMIT ?)`).run(HISTORY_LIMIT);

      let lastChoiceRetained = false;
      if (removeWinner && rows.length > 1) {
        db.prepare('DELETE FROM choices WHERE id = ?').run(chosen.id);
        compactPositions();
      } else if (removeWinner && rows.length === 1) {
        lastChoiceRetained = true;
      }
      writeSetting('removeWinnerAfterSpin', removeWinner ? 'true' : 'false');
      spinResult = {
        winner: chosen.label,
        chosenIndex,
        wheelChoices: rows.map((row) => row.label),
        choices: getChoices().map((row) => row.label),
        history: getHistory(),
        lastChoiceRetained
      };
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return json(res, 200, spinResult);
  }

  if (req.method === 'DELETE' && url.pathname === '/api/history') {
    db.exec('DELETE FROM recent_results');
    return json(res, 200, { history: [] });
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings') {
    const body = await readJson(req);
    if (typeof body.removeWinnerAfterSpin !== 'boolean') {
      return error(res, 400, 'removeWinnerAfterSpin must be true or false.');
    }
    writeSetting('removeWinnerAfterSpin', body.removeWinnerAfterSpin ? 'true' : 'false');
    return json(res, 200, { settings: { removeWinnerAfterSpin: body.removeWinnerAfterSpin } });
  }

  return error(res, 404, 'API endpoint not found.');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': html.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      });
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }
    error(res, 404, 'Not found.');
  } catch (e) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const code = e.statusCode || (e.message && /Choices|choice|140 characters|100 choices|at least one/i.test(e.message) ? 400 : 500);
    if (code >= 500) console.error(e);
    error(res, code, code >= 500 ? 'An unexpected server error occurred.' : e.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Harvest is running at http://${HOST}:${PORT}/`);
  console.log(`SQLite database: ${DB_PATH}`);
  console.log('Press Ctrl+C to stop the server.');
});

function close() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
