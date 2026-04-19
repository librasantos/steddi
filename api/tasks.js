// api/tasks.js — Cloud sync for tasks, backlog, scheduled, history
// Keyed by device code. Writes are last-wins. Uses updatedAt timestamps for conflict resolution.

import { kv } from './_kv.js';

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB safety cap
const TTL_DAYS = 180; // Keep data for 6 months of inactivity
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

function sanitizeCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeTaskArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(x => x && typeof x === 'object' && typeof x.text === 'string').slice(0, 500);
}

export default async function handler(req, res) {
  // CORS for safety
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const code = sanitizeCode(req.query?.code || req.body?.code);
  if (!code) {
    res.status(400).json({ error: 'Missing or invalid device code' });
    return;
  }

  const key = `steddi:tasks:${code}`;

  if (req.method === 'GET') {
    try {
      const raw = await kv.get(key);
      if (!raw) {
        res.status(200).json({ exists: false });
        return;
      }
      // Redis client may return a parsed object or a string
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      res.status(200).json({ exists: true, data });
    } catch (err) {
      console.error('[tasks] GET failed:', err?.message);
      res.status(500).json({ error: 'Failed to load tasks' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const payload = {
        activeTasks: sanitizeTaskArray(body.activeTasks),
        allTasks: sanitizeTaskArray(body.allTasks),
        dumpItems: sanitizeTaskArray(body.dumpItems),
        deferred: sanitizeTaskArray(body.deferred),
        doneTasks: sanitizeTaskArray(body.doneTasks),
        history: Array.isArray(body.history) ? body.history.slice(0, 100) : [],
        updatedAt: Date.now(),
      };
      const serialized = JSON.stringify(payload);
      if (serialized.length > MAX_BODY_SIZE) {
        res.status(413).json({ error: 'Payload too large' });
        return;
      }
      await kv.set(key, serialized, { ex: TTL_SECONDS });
      res.status(200).json({ ok: true, updatedAt: payload.updatedAt });
    } catch (err) {
      console.error('[tasks] POST failed:', err?.message);
      res.status(500).json({ error: 'Failed to save tasks' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
