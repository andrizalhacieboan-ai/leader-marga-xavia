import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);
const adminUsername = process.env.ADMIN_USERNAME || 'andriyt';
const adminPassword = process.env.ADMIN_PASSWORD || 'andri2002';
const tursoUrl = process.env.TURSO_DATABASE_URL || 'libsql://reviactyl-andri.aws-ap-south-1.turso.io';
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN || '';
const sessions = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function normalizeSqlValue(value) {
  if (value === null || value === undefined) return { type: 'null' };
  if (Number.isInteger(value)) return { type: 'integer', value: String(value) };
  if (typeof value === 'number') return { type: 'float', value };
  if (Buffer.isBuffer(value)) return { type: 'blob', base64: value.toString('base64') };
  return { type: 'text', value: String(value) };
}

function denormalizeSqlValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (value.type === 'null') return null;
  if (value.type === 'integer') return Number(value.value);
  if (value.type === 'float') return Number(value.value);
  if (value.type === 'blob') return value.base64 || value.value || '';
  return value.value ?? null;
}

function createRows(result) {
  const columns = result.cols || [];
  return (result.rows || []).map((rowValues) => Object.fromEntries(
    rowValues.map((cell, index) => [columns[index]?.name || String(index), denormalizeSqlValue(cell)]),
  ));
}

function splitSqlStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function getLocalDbPath() {
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  const writableRuntime = process.env.VERCEL
    || process.env.AWS_LAMBDA_FUNCTION_NAME
    || process.env.LAMBDA_TASK_ROOT
    || __dirname.startsWith('/var/task')
    || process.cwd().startsWith('/var/task');
  return writableRuntime ? path.join(os.tmpdir(), 'reviactyl.db') : path.join(__dirname, 'reviactyl.db');
}

async function createLocalDatabase() {
  const { DatabaseSync } = await import('node:sqlite');
  let localPath = getLocalDbPath();
  let database;

  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    database = new DatabaseSync(localPath);
  } catch (error) {
    if (process.env.SQLITE_PATH) throw error;
    localPath = path.join(os.tmpdir(), 'reviactyl.db');
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    database = new DatabaseSync(localPath);
  }

  return {
    mode: 'local-sqlite',
    label: localPath,
    async execute(sql, args = []) {
      const statement = database.prepare(sql);
      const isRead = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);
      if (isRead) return { rows: statement.all(...args), lastInsertRowid: null, rowsAffected: 0 };
      const result = statement.run(...args);
      return { rows: [], lastInsertRowid: result.lastInsertRowid, rowsAffected: result.changes };
    },
    async exec(sql) {
      database.exec(sql);
    },
  };
}

function createTursoDatabase() {
  const pipelineUrl = `${tursoUrl.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '')}/v2/pipeline`;

  async function execute(sql, args = []) {
    const response = await fetch(pipelineUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tursoAuthToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            type: 'execute',
            stmt: { sql, args: args.map(normalizeSqlValue) },
          },
          { type: 'close' },
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || `Turso request failed with status ${response.status}`);
    }

    const firstResult = payload.results?.[0];
    if (!firstResult || firstResult.type !== 'ok') {
      throw new Error(firstResult?.error?.message || firstResult?.error || 'Turso query failed.');
    }

    const result = firstResult.response?.result || {};
    return {
      rows: createRows(result),
      lastInsertRowid: result.last_insert_rowid ?? null,
      rowsAffected: result.affected_row_count ?? 0,
    };
  }

  return {
    mode: 'turso-http',
    label: tursoUrl,
    execute,
    async exec(sql) {
      for (const statement of splitSqlStatements(sql)) {
        await execute(statement);
      }
    },
  };
}

async function createDatabase() {
  if (tursoAuthToken) return createTursoDatabase();
  return createLocalDatabase();
}

const db = await createDatabase();

async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS snippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      language TEXT NOT NULL,
      code TEXT NOT NULL,
      views INTEGER DEFAULT 0,
      copies INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .filter(Boolean)
      .map((cookie) => {
        const [key, ...value] = cookie.trim().split('=');
        return [key, decodeURIComponent(value.join('='))];
      }),
  );
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `reviactyl_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'reviactyl_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function createSession(payload) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { ...payload, createdAt: Date.now() });
  return token;
}

function currentSession(req) {
  const token = parseCookies(req).reviactyl_session;
  const session = token ? sessions.get(token) : null;
  return session ? { token, ...session } : null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), candidate);
}

function validateText(value, field, max = 120) {
  const text = String(value || '').trim();
  if (!text) return `${field} wajib diisi.`;
  if (text.length > max) return `${field} maksimal ${max} karakter.`;
  return null;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function rows(sql, args = []) {
  const result = await db.execute(sql, args);
  return result.rows;
}

async function row(sql, args = []) {
  const result = await db.execute(sql, args);
  return result.rows[0];
}

async function run(sql, args = []) {
  return db.execute(sql, args);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(publicDir, 'index.html'), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fallback);
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const session = currentSession(req);

  if (req.method === 'GET' && pathname === '/api/session') {
    return sendJson(res, 200, session ? { loggedIn: true, role: session.role, username: session.username } : { loggedIn: false });
  }

  if (req.method === 'POST' && pathname === '/api/register') {
    const body = await readJson(req);
    const username = String(body.username || '').trim();
    const usernameError = validateText(username, 'Username', 32);
    const passwordError = validateText(body.password, 'Password', 100);
    if (usernameError || passwordError) return sendJson(res, 400, { message: usernameError || passwordError });
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      return sendJson(res, 400, { message: 'Username hanya boleh huruf, angka, underscore (3-32 karakter).' });
    }

    try {
      const result = await run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hashPassword(body.password)]);
      const token = createSession({ role: 'user', userId: Number(result.lastInsertRowid), username });
      setSessionCookie(res, token);
      return sendJson(res, 201, { message: 'Registrasi berhasil.', username });
    } catch (error) {
      return sendJson(res, 409, { message: 'Username sudah digunakan.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    const body = await readJson(req);
    const user = await row('SELECT * FROM users WHERE username = ?', [String(body.username || '').trim()]);
    if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) {
      return sendJson(res, 401, { message: 'Username atau password salah.' });
    }
    const token = createSession({ role: 'user', userId: Number(user.id), username: user.username });
    setSessionCookie(res, token);
    return sendJson(res, 200, { message: 'Login berhasil.', username: user.username });
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    const body = await readJson(req);
    if (body.username !== adminUsername || body.password !== adminPassword) {
      return sendJson(res, 401, { message: 'Username atau password admin salah.' });
    }
    const token = createSession({ role: 'admin', username: adminUsername });
    setSessionCookie(res, token);
    return sendJson(res, 200, { message: 'Login admin berhasil.', username: adminUsername });
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    if (session) sessions.delete(session.token);
    clearSessionCookie(res);
    return sendJson(res, 200, { message: 'Logout berhasil.' });
  }

  if (req.method === 'GET' && pathname === '/api/snippets') {
    const snippets = await rows(`
      SELECT snippets.id, snippets.title, snippets.description, snippets.language,
             snippets.views, snippets.copies, snippets.created_at, users.username
      FROM snippets
      JOIN users ON users.id = snippets.user_id
      ORDER BY snippets.created_at DESC
    `);
    return sendJson(res, 200, snippets);
  }

  const detailMatch = pathname.match(/^\/api\/snippets\/(\d+)$/);
  if (req.method === 'GET' && detailMatch) {
    await run('UPDATE snippets SET views = views + 1 WHERE id = ?', [Number(detailMatch[1])]);
    const snippet = await row(`
      SELECT snippets.*, users.username
      FROM snippets
      JOIN users ON users.id = snippets.user_id
      WHERE snippets.id = ?
    `, [Number(detailMatch[1])]);
    if (!snippet) return sendJson(res, 404, { message: 'Snippet tidak ditemukan.' });
    return sendJson(res, 200, snippet);
  }

  if (req.method === 'POST' && pathname === '/api/snippets') {
    if (!session || session.role !== 'user') return sendJson(res, 401, { message: 'Silakan login user terlebih dahulu.' });
    const body = await readJson(req);
    const titleError = validateText(body.title, 'Judul', 120);
    const descriptionError = validateText(body.description, 'Deskripsi', 500);
    const languageError = validateText(body.language, 'Bahasa pemrograman', 40);
    const code = String(body.code || '').trim();
    if (titleError || descriptionError || languageError) return sendJson(res, 400, { message: titleError || descriptionError || languageError });
    if (!code) return sendJson(res, 400, { message: 'Kode wajib diisi.' });
    if (code.length > 50000) return sendJson(res, 400, { message: 'Kode maksimal 50.000 karakter.' });

    const result = await run(
      'INSERT INTO snippets (user_id, title, description, language, code) VALUES (?, ?, ?, ?, ?)',
      [session.userId, body.title.trim(), body.description.trim(), body.language.trim(), code],
    );
    return sendJson(res, 201, { message: 'Snippet berhasil diupload.', id: Number(result.lastInsertRowid) });
  }

  const copyMatch = pathname.match(/^\/api\/snippets\/(\d+)\/copy$/);
  if (req.method === 'POST' && copyMatch) {
    await run('UPDATE snippets SET copies = copies + 1 WHERE id = ?', [Number(copyMatch[1])]);
    const snippet = await row('SELECT copies FROM snippets WHERE id = ?', [Number(copyMatch[1])]);
    if (!snippet) return sendJson(res, 404, { message: 'Snippet tidak ditemukan.' });
    return sendJson(res, 200, { copies: Number(snippet.copies) });
  }

  if (req.method === 'GET' && pathname === '/api/admin/stats') {
    if (!session || session.role !== 'admin') return sendJson(res, 401, { message: 'Akses admin ditolak.' });
    const totals = await row(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM snippets) AS snippets,
        (SELECT COALESCE(SUM(views), 0) FROM snippets) AS views,
        (SELECT COALESCE(SUM(copies), 0) FROM snippets) AS copies
    `);
    const snippets = await rows(`
      SELECT snippets.id, snippets.title, snippets.language, snippets.views, snippets.copies,
             snippets.created_at, users.username
      FROM snippets
      JOIN users ON users.id = snippets.user_id
      ORDER BY snippets.created_at DESC
    `);
    return sendJson(res, 200, { totals, snippets });
  }

  const deleteMatch = pathname.match(/^\/api\/admin\/snippets\/(\d+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    if (!session || session.role !== 'admin') return sendJson(res, 401, { message: 'Akses admin ditolak.' });
    await run('DELETE FROM snippets WHERE id = ?', [Number(deleteMatch[1])]);
    return sendJson(res, 200, { message: 'Snippet dihapus.' });
  }

  return sendJson(res, 404, { message: 'Endpoint tidak ditemukan.' });
}

await initDb();

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    try {
      await handleApi(req, res);
    } catch (error) {
      sendJson(res, 500, { message: 'Server error.', detail: error.message });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`Reviactyl Snippet Share berjalan di http://localhost:${port}`);
  console.log(`Database mode: ${db.mode} (${db.label})`);
});
