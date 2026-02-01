#!/usr/bin/env node


import { createServer } from 'node:http';
import { createConnection } from '../dist/index.js';

const API_PORT = Number(process.env.API_PORT) || 3040;
const REALTIME_PORT = Number(process.env.REALTIME_PORT) || 3041;

const db = createConnection({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'app_user',
  password: process.env.MYSQL_PASSWORD || 'password_fort',
  database: process.env.MYSQL_DATABASE || 'mydb',
  realtime: {
    port: REALTIME_PORT,
    path: '/realtime',
  },
});

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, data) {
  cors(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url?.split('?')[0] ?? '';
  const method = req.method;

  if (method === 'GET' && url === '/api/users') {
    try {
      const rows = await db.query('SELECT id, name, email, created_at FROM users ORDER BY id');
      sendJson(res, 200, rows);
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (method === 'POST' && url === '/api/users') {
    try {
      const body = await parseBody(req);
      const { name, email } = body;
      if (!name || !email) {
        sendJson(res, 400, { error: 'name et email requis' });
        return;
      }
      const id = await db.insert('users', { name: String(name), email: String(email) });
      sendJson(res, 201, { id, name, email });
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  const patchMatch = url.match(/^\/api\/users\/(\d+)$/);
  if (method === 'PATCH' && patchMatch) {
    const id = Number(patchMatch[1]);
    try {
      const body = await parseBody(req);
      const updates = {};
      if (body.name !== undefined) updates.name = String(body.name);
      if (body.email !== undefined) updates.email = String(body.email);
      if (Object.keys(updates).length === 0) {
        sendJson(res, 400, { error: 'aucun champ à mettre à jour' });
        return;
      }
      await db.update('users', { id }, updates);
      const [row] = await db.query('SELECT id, name, email, created_at FROM users WHERE id = ?', [id]);
      sendJson(res, 200, row ?? { id, ...updates });
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  const deleteMatch = url.match(/^\/api\/users\/(\d+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const id = Number(deleteMatch[1]);
    try {
      await db.delete('users', { id });
      sendJson(res, 200, { deleted: id });
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  cors(res);
  res.writeHead(404);
  res.end('Not Found');
}

async function main() {
  await db.connect();
  await ensureTable();
  await db.startRealtimeServer();

  const server = createServer(handleRequest);
  server.listen(API_PORT, () => {
    console.log('Exemple CRUD ');
    console.log('  API REST :     http://localhost:' + API_PORT + '/api/users');
    console.log('  WebSocket :   ws://localhost:' + REALTIME_PORT + '/realtime');
    console.log('  Page de test : ouvrir test/test-realtime.html pour tester le CRUD\n');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
