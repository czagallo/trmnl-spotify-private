const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { createApp, createCache } = require('../server');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const TOKEN = 'BQD-test-access-token-0123456789';

const ROUTES = {
  '/v1/me/player/currently-playing': 'currently-playing.json',
  '/v1/me/player/recently-played': 'recently-played.json',
  '/v1/me/top/tracks': 'top-tracks.json',
  '/v1/me/top/artists': 'top-artists.json'
};

// Fake request function: (path, token) -> { statusCode, data, headers }.
// `overrides` maps a path prefix to a result object, an Error to reject with, or a function.
function fakeRequest(overrides = {}) {
  const calls = [];
  const fn = async (reqPath, token) => {
    calls.push({ path: reqPath, token });
    const base = reqPath.split('?')[0];
    if (base in overrides) {
      const o = overrides[base];
      if (o instanceof Error) throw o;
      return typeof o === 'function' ? o() : o;
    }
    return { statusCode: 200, data: fixture(ROUTES[base]), headers: {} };
  };
  fn.calls = calls;
  return fn;
}

function allPaths(result) {
  return Object.fromEntries(Object.keys(ROUTES).map((p) => [p, result]));
}

// Capture console output to prove tokens and bodies are never logged.
let logs;
let original;
beforeEach(() => {
  logs = [];
  original = { log: console.log, error: console.error };
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
});
afterEach(() => {
  console.log = original.log;
  console.error = original.error;
});

async function poll(app, headers = { authorization: `Bearer ${TOKEN}` }) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/spotify`, { headers });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe('/api/spotify', () => {
  test('now playing + lists', async () => {
    const request = fakeRequest();
    const { status, body } = await poll(createApp({ request }));
    assert.equal(status, 200);
    assert.equal(body.has_now_playing, true);
    assert.equal(body.now_playing_track, 'Bohemian Rhapsody');
    assert.equal(body.now_playing_artist, 'Queen');
    assert.equal(body.now_playing_is_active, true);
    assert.equal(body.recent_count, 3);
    assert.equal(body.recent_tracks[2].track_name, 'Unknown');
    assert.equal(body.top_tracks[0].artist_name, 'Lady Gaga, Bruno Mars');
    assert.equal(body.top_tracks[2].track_name, 'Unknown');
    assert.equal(body.top_artists[0].genres, 'alternative rock, art rock');
    assert.equal(body.top_artists[1].genres, '');
    assert.equal(request.calls.length, 4);
    assert.ok(request.calls.every((c) => c.token === TOKEN));
  });

  test('nothing playing (204)', async () => {
    const request = fakeRequest({ '/v1/me/player/currently-playing': { statusCode: 204, data: null, headers: {} } });
    const { body } = await poll(createApp({ request }));
    assert.equal(body.has_now_playing, false);
    assert.equal(body.now_playing_track, '');
    assert.equal(body.top_tracks_count, 3);
  });

  test('missing Authorization header', async () => {
    const request = fakeRequest();
    const { body } = await poll(createApp({ request }), {});
    assert.equal(body.error, true);
    assert.match(body.error_message, /No Spotify token/);
    assert.equal(request.calls.length, 0);
  });

  test('401 -> token expired message instead of empty lists', async () => {
    const request = fakeRequest(allPaths({ statusCode: 401, data: fixture('error-401.json'), headers: {} }));
    const { status, body } = await poll(createApp({ request }));
    assert.equal(status, 200);
    assert.equal(body.error, true);
    assert.equal(body.error_kind, 'token_expired');
    assert.match(body.error_message, /token expired/i);
    assert.equal(body.top_tracks, undefined);
  });

  test('429 on one endpoint -> rate limited message, cached for Retry-After', async () => {
    let now = 1000;
    const cache = createCache({ ttlMs: 60000, now: () => now });
    const request = fakeRequest({ '/v1/me/top/tracks': { statusCode: 429, data: null, headers: { 'retry-after': '30' } } });
    const app = createApp({ request, cache });
    const first = await poll(app);
    assert.equal(first.body.error_kind, 'rate_limited');
    assert.match(first.body.error_message, /rate limited/i);
    const callsAfterFirst = request.calls.length;
    now += 29000;
    await poll(app);
    assert.equal(request.calls.length, callsAfterFirst, 'no Spotify calls during Retry-After');
    now += 2000;
    await poll(app);
    assert.ok(request.calls.length > callsAfterFirst);
  });

  test('403 -> scope hint', async () => {
    const request = fakeRequest({ '/v1/me/top/artists': { statusCode: 403, data: null, headers: {} } });
    const { body } = await poll(createApp({ request }));
    assert.equal(body.error_kind, 'forbidden');
    assert.match(body.error_message, /scopes/);
  });

  test('a non-JSON 200 on one endpoint degrades that list only', async () => {
    const request = fakeRequest({ '/v1/me/top/artists': new Error('Failed to parse Spotify response: Unexpected token <') });
    const { body } = await poll(createApp({ request }));
    assert.equal(body.error, undefined);
    assert.equal(body.top_artists_count, 0);
    assert.equal(body.top_tracks_count, 3);
  });

  test('all requests failing -> error, not cached', async () => {
    const request = fakeRequest(allPaths(new Error('Spotify API request timed out')));
    const app = createApp({ request });
    const { body } = await poll(app);
    assert.equal(body.error, true);
    assert.equal(body.error_kind, 'unavailable');
    await poll(app);
    assert.equal(request.calls.length, 8);
  });

  test('successful responses are cached per token', async () => {
    const request = fakeRequest();
    const app = createApp({ request });
    await poll(app);
    await poll(app);
    assert.equal(request.calls.length, 4);
    await poll(app, { authorization: 'Bearer another-token-abcdef' });
    assert.equal(request.calls.length, 8);
  });

  test('errors 401 are not cached', async () => {
    const request = fakeRequest(allPaths({ statusCode: 401, data: null, headers: {} }));
    const app = createApp({ request });
    await poll(app);
    await poll(app);
    assert.equal(request.calls.length, 8);
  });

  test('never logs the token or Spotify bodies', async () => {
    const request = fakeRequest(allPaths({ statusCode: 500, data: { error: { message: 'secret-body-marker' } }, headers: {} }));
    await poll(createApp({ request }));
    const all = logs.join('\n');
    assert.ok(!all.includes(TOKEN));
    assert.ok(!all.includes(TOKEN.slice(0, 8)));
    assert.ok(!all.includes('secret-body-marker'));
    assert.match(all, /status=500/);
  });
});

describe('cache', () => {
  test('keys are sha256 of the token, never the token', async () => {
    const cache = createCache();
    await cache.get(TOKEN, async () => ({ body: { ok: true } }));
    const expected = crypto.createHash('sha256').update(TOKEN).digest('hex');
    assert.deepEqual(cache.keys(), [expected]);
  });

  test('is bounded', async () => {
    const cache = createCache({ maxEntries: 3 });
    for (let i = 0; i < 10; i += 1) {
      await cache.get(`token-${i}`, async () => ({ body: { i } }));
    }
    assert.equal(cache.size(), 3);
  });

  test('expires after ttl', async () => {
    let now = 0;
    let loads = 0;
    const cache = createCache({ ttlMs: 1000, now: () => now });
    const load = async () => ({ body: { n: ++loads } });
    await cache.get('t', load);
    now = 999;
    await cache.get('t', load);
    now = 1001;
    await cache.get('t', load);
    assert.equal(loads, 2);
  });

  test('coalesces concurrent requests for the same token', async () => {
    let loads = 0;
    const cache = createCache();
    const load = () => new Promise((r) => setTimeout(() => r({ body: { n: ++loads } }), 20));
    await Promise.all([cache.get('t', load), cache.get('t', load), cache.get('t', load)]);
    assert.equal(loads, 1);
  });
});
