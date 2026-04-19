// api/_kv.js — Compatibility shim for @vercel/kv using @upstash/redis
//
// Background: Vercel deprecated their own KV product in December 2024 and now
// uses Upstash Redis under the hood. New databases created via the Vercel
// Marketplace only set REDIS_URL (or KV_REST_API_URL / KV_REST_API_TOKEN if
// you're lucky), not the full set of vars that @vercel/kv expects.
//
// This shim exports a `kv` object with the same interface Steddi's code
// already uses (`get`, `set`, `incr`, `expire`), but backed by @upstash/redis.
// Drop-in replacement — just change `import { kv } from '@vercel/kv'` to
// `import { kv } from './_kv.js'` in each api file.
//
// The shim auto-detects whichever env vars are available in priority order:
//   1. KV_REST_API_URL + KV_REST_API_TOKEN (classic Vercel KV REST)
//   2. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (direct Upstash)
//   3. REDIS_URL (raw Redis protocol — requires a different client)
//
// For option 3, we use Redis.fromEnv() from @upstash/redis which knows how
// to handle multiple formats.

import { Redis } from '@upstash/redis';

// Build the Redis client from whatever env vars are available.
// @upstash/redis.fromEnv() automatically looks for KV_REST_API_URL/TOKEN
// or UPSTASH_REDIS_REST_URL/TOKEN.
let _client = null;
function getClient() {
  if (_client) return _client;
  try {
    // Prefer explicit construction if KV_REST_API_* vars exist (most common on Vercel)
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      _client = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
      return _client;
    }
    // Fall back to direct Upstash vars
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      _client = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      return _client;
    }
    // Last resort: fromEnv picks up whatever is available
    _client = Redis.fromEnv();
    return _client;
  } catch (err) {
    console.error('[_kv] Failed to initialize Redis client:', err?.message);
    return null;
  }
}

// Shim object — same interface as @vercel/kv
export const kv = {
  async get(key) {
    const client = getClient();
    if (!client) return null;
    try {
      const v = await client.get(key);
      // @upstash/redis auto-parses JSON. @vercel/kv does the same.
      // Both return null for missing keys.
      return v;
    } catch (err) {
      console.error(`[_kv] get(${key}) failed:`, err?.message);
      return null;
    }
  },

  async set(key, value, options) {
    const client = getClient();
    if (!client) return null;
    try {
      // Map @vercel/kv options to @upstash/redis options
      // @vercel/kv accepts { ex: seconds } for TTL
      // @upstash/redis accepts the same { ex: seconds }
      if (options && typeof options === 'object' && options.ex) {
        return await client.set(key, value, { ex: options.ex });
      }
      return await client.set(key, value);
    } catch (err) {
      console.error(`[_kv] set(${key}) failed:`, err?.message);
      return null;
    }
  },

  async incr(key) {
    const client = getClient();
    if (!client) return 0;
    try {
      return await client.incr(key);
    } catch (err) {
      console.error(`[_kv] incr(${key}) failed:`, err?.message);
      return 0;
    }
  },

  async expire(key, seconds) {
    const client = getClient();
    if (!client) return false;
    try {
      return await client.expire(key, seconds);
    } catch (err) {
      console.error(`[_kv] expire(${key}) failed:`, err?.message);
      return false;
    }
  },

  async del(key) {
    const client = getClient();
    if (!client) return 0;
    try {
      return await client.del(key);
    } catch (err) {
      console.error(`[_kv] del(${key}) failed:`, err?.message);
      return 0;
    }
  },
};
