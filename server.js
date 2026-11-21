require('dotenv').config();
const express = require('express');
const https = require('https');
const crypto = require('crypto');

const PORT = process.env.PORT || 3006;
// Loopback by default: the service is meant to sit behind a local tunnel/reverse proxy.
// Set HOST=0.0.0.0 only if the proxy runs on another machine.
const HOST = process.env.HOST || '127.0.0.1';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 60000;
const CACHE_MAX_ENTRIES = 100;
const RATE_LIMIT_MAX_BACKOFF_MS = 300000;

// ============================================================
// SPOTIFY API FUNCTIONS
// ============================================================

class SpotifyError extends Error {
  constructor(kind, statusCode, retryAfterMs) {
    super(`Spotify ${kind} (status ${statusCode})`);
    this.kind = kind;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

// Resolves { statusCode, data, headers } (data is null for 204 and for non-JSON error
// bodies); rejects on network errors, timeouts and non-JSON 2xx bodies.
function spotifyRequest(path, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.spotify.com',
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 204 || body === '') {
          resolve({ statusCode: res.statusCode, data: null, headers: res.headers });
          return;
        }
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(body), headers: res.headers });
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            reject(new Error(`Failed to parse Spotify response: ${e.message}`));
          } else {
            resolve({ statusCode: res.statusCode, data: null, headers: res.headers });
          }
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Spotify API request timed out'));
    });
    req.end();
  });
}

function retryAfterMs(headers) {
  const seconds = Number((headers || {})['retry-after']);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

// Throws SpotifyError for 401/403/429 so the route can explain the problem; logs status only.
function checkStatus(label, result) {
  const status = result ? result.statusCode : 0;
  if (status === 401) throw new SpotifyError('token_expired', status);
  if (status === 403) throw new SpotifyError('forbidden', status);
  if (status === 429) throw new SpotifyError('rate_limited', status, retryAfterMs(result.headers));
  if (status !== 200 && status !== 204) {
    console.error(`${label} response: status=${status}`);
  }
}

async function getCurrentlyPlaying(request, token) {
  const result = await request('/v1/me/player/currently-playing', token);
  checkStatus('currently-playing', result);
  if (!result || result.statusCode !== 200 || !result.data || !result.data.item) {
    return null;
  }
  const track = result.data.item;
  return {
    track_name: track.name || 'Unknown',
    artist_name: (track.artists || []).map(a => a.name).join(', ') || 'Unknown',
    album_name: (track.album || {}).name || 'Unknown',
    is_playing: result.data.is_playing || false
  };
}

async function getRecentlyPlayed(request, token, limit) {
  const result = await request(`/v1/me/player/recently-played?limit=${limit}`, token);
  checkStatus('recently-played', result);
  if (!result || result.statusCode !== 200 || !result.data || !Array.isArray(result.data.items)) {
    return [];
  }
  return result.data.items.map((item, idx) => ({
    track_name: (item.track || {}).name || 'Unknown',
    artist_name: ((item.track || {}).artists || []).map(a => a.name).join(', ') || 'Unknown',
    album_name: ((item.track || {}).album || {}).name || 'Unknown',
    played_at: item.played_at || '',
    index: idx + 1
  }));
}

async function getTopTracks(request, token, timeRange, limit) {
  const result = await request(`/v1/me/top/tracks?time_range=${timeRange}&limit=${limit}`, token);
  checkStatus('top-tracks', result);
  if (!result || result.statusCode !== 200 || !result.data || !Array.isArray(result.data.items)) {
    return [];
  }
  return result.data.items.map((track, idx) => ({
    track_name: track.name || 'Unknown',
    artist_name: (track.artists || []).map(a => a.name).join(', ') || 'Unknown',
    album_name: (track.album || {}).name || 'Unknown',
    index: idx + 1
  }));
}

async function getTopArtists(request, token, timeRange, limit) {
  const result = await request(`/v1/me/top/artists?time_range=${timeRange}&limit=${limit}`, token);
  checkStatus('top-artists', result);
  if (!result || result.statusCode !== 200 || !result.data || !Array.isArray(result.data.items)) {
    return [];
  }
  return result.data.items.map((artist, idx) => ({
    artist_name: artist.name || 'Unknown',
    genres: (artist.genres || []).slice(0, 2).join(', ') || '',
    index: idx + 1
  }));
}

const ERROR_MESSAGES = {
  token_expired: 'Spotify token expired. TRMNL refreshes it automatically; if this persists, reconnect Spotify in the plugin settings.',
  forbidden: 'Spotify refused access. Check the OAuth scopes: user-read-currently-playing user-read-recently-played user-top-read.',
  rate_limited: 'Spotify rate limited this plugin. Data will refresh on a later poll.'
};

async function fetchSpotifyData(request, token) {
  const failures = [];
  let otherFailures = 0;
  const soft = (label, fallback) => (e) => {
    if (e instanceof SpotifyError) {
      failures.push(e);
    } else {
      otherFailures += 1;
      console.error(`${label} error:`, e.message);
    }
    return fallback;
  };

  const [nowPlaying, recentTracks, topTracks, topArtists] = await Promise.all([
    getCurrentlyPlaying(request, token).catch(soft('currently-playing', null)),
    getRecentlyPlayed(request, token, 5).catch(soft('recently-played', [])),
    getTopTracks(request, token, 'short_term', 5).catch(soft('top-tracks', [])),
    getTopArtists(request, token, 'short_term', 5).catch(soft('top-artists', []))
  ]);

  for (const kind of ['token_expired', 'forbidden', 'rate_limited']) {
    const failure = failures.find((f) => f.kind === kind);
    if (failure) {
      console.error(`Spotify request failed: ${kind} (status ${failure.statusCode})`);
      return {
        body: { error: true, error_kind: kind, error_message: ERROR_MESSAGES[kind] },
        retryAfterMs: failure.retryAfterMs
      };
    }
  }

  if (otherFailures === 4) {
    return {
      body: { error: true, error_kind: 'unavailable', error_message: 'Could not reach Spotify. Data will refresh on a later poll.' }
    };
  }

  return {
    body: {
      has_now_playing: nowPlaying !== null,
      now_playing_track: nowPlaying ? nowPlaying.track_name : '',
      now_playing_artist: nowPlaying ? nowPlaying.artist_name : '',
      now_playing_album: nowPlaying ? nowPlaying.album_name : '',
      now_playing_is_active: nowPlaying ? nowPlaying.is_playing : false,
      recent_tracks: recentTracks,
      recent_count: recentTracks.length,
      top_tracks: topTracks,
      top_tracks_count: topTracks.length,
      top_artists: topArtists,
      top_artists_count: topArtists.length,
      updated_at: new Date().toISOString()
    }
  };
}

// ============================================================
// RESPONSE CACHE
// ============================================================

// Short per-token cache so TRMNL polling (and retries) cannot exceed Spotify rate limits.
// Keys are sha256 digests of the token; the token itself is never stored.
function createCache({ ttlMs = CACHE_TTL_MS, maxEntries = CACHE_MAX_ENTRIES, now = Date.now } = {}) {
  const entries = new Map();
  const inFlight = new Map();

  function keyFor(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  function prune() {
    const t = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= t) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  async function get(token, load) {
    const key = keyFor(token);
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now()) return hit.value;
    if (inFlight.has(key)) return inFlight.get(key);

    const promise = (async () => {
      const { body, retryAfterMs: retryMs } = await load();
      let ttl = 0;
      if (!body.error) {
        ttl = ttlMs;
      } else if (body.error_kind === 'rate_limited') {
        ttl = Math.min(retryMs || ttlMs, RATE_LIMIT_MAX_BACKOFF_MS);
      }
      if (ttl > 0) {
        entries.delete(key);
        entries.set(key, { value: body, expiresAt: now() + ttl });
        prune();
      }
      return body;
    })();
    inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(key);
    }
  }

  return { get, size: () => entries.size, keys: () => [...entries.keys()] };
}

// ============================================================
// EXPRESS APP
// ============================================================

function createApp({ request = spotifyRequest, cache = createCache() } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/spotify', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.length <= 'Bearer '.length) {
      console.error('Missing or invalid Authorization header');
      return res.json({
        error: true,
        error_message: 'No Spotify token provided. Please connect Spotify via OAuth2 in your TRMNL plugin settings.'
      });
    }

    const accessToken = authHeader.slice('Bearer '.length);

    try {
      const body = await cache.get(accessToken, () => fetchSpotifyData(request, accessToken));
      if (!body.error) {
        console.log(`Spotify data: now_playing=${body.has_now_playing}, recent=${body.recent_count}, top_tracks=${body.top_tracks_count}, top_artists=${body.top_artists_count}`);
      }
      res.json(body);
    } catch (err) {
      console.error('Error fetching Spotify data:', err.message);
      res.json({
        error: true,
        error_message: 'Failed to fetch Spotify data. Please try again later.'
      });
    }
  });

  // ============================================================
  // HEALTH CHECK
  // ============================================================

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/', (req, res) => {
    res.json({ status: 'ok', plugin: 'trmnl-spotify-private', version: '1.0.0' });
  });

  return app;
}

// ============================================================
// START SERVER
// ============================================================

if (require.main === module) {
  createApp().listen(PORT, HOST, () => {
    console.log(`trmnl-spotify-private running on ${HOST}:${PORT}`);
  });
}

module.exports = {
  createApp,
  createCache,
  fetchSpotifyData,
  spotifyRequest,
  SpotifyError,
  ERROR_MESSAGES
};
