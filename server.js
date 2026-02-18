require('dotenv').config();
const express = require('express');
const https = require('https');

const PORT = process.env.PORT || 3006;
const app = express();

// ============================================================
// SPOTIFY API FUNCTIONS
// ============================================================

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
        if (res.statusCode === 204) {
          resolve(null);
          return;
        }
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          reject(new Error(`Failed to parse Spotify response: ${e.message}`));
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

async function getCurrentlyPlaying(token) {
  const result = await spotifyRequest('/v1/me/player/currently-playing', token);
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

async function getRecentlyPlayed(token, limit) {
  const result = await spotifyRequest(`/v1/me/player/recently-played?limit=${limit}`, token);
  if (!result || result.statusCode !== 200 || !result.data || !result.data.items) {
    console.error('recently-played response:', result ? `status=${result.statusCode} body=${JSON.stringify(result.data).substring(0, 200)}` : 'null');
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

async function getTopTracks(token, timeRange, limit) {
  const result = await spotifyRequest(`/v1/me/top/tracks?time_range=${timeRange}&limit=${limit}`, token);
  if (!result || result.statusCode !== 200 || !result.data || !result.data.items) {
    console.error('top-tracks response:', result ? `status=${result.statusCode} body=${JSON.stringify(result.data).substring(0, 200)}` : 'null');
    return [];
  }
  return result.data.items.map((track, idx) => ({
    track_name: track.name || 'Unknown',
    artist_name: (track.artists || []).map(a => a.name).join(', ') || 'Unknown',
    album_name: (track.album || {}).name || 'Unknown',
    index: idx + 1
  }));
}

async function getTopArtists(token, timeRange, limit) {
  const result = await spotifyRequest(`/v1/me/top/artists?time_range=${timeRange}&limit=${limit}`, token);
  if (!result || result.statusCode !== 200 || !result.data || !result.data.items) {
    console.error('top-artists response:', result ? `status=${result.statusCode} body=${JSON.stringify(result.data).substring(0, 200)}` : 'null');
    return [];
  }
  return result.data.items.map((artist, idx) => ({
    artist_name: artist.name || 'Unknown',
    genres: (artist.genres || []).slice(0, 2).join(', ') || '',
    index: idx + 1
  }));
}

// ============================================================
// POLLING ENDPOINT
// ============================================================

app.get('/api/spotify', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('Missing or invalid Authorization header');
    return res.json({
      error: true,
      error_message: 'No Spotify token provided. Please connect Spotify via OAuth2 in your TRMNL plugin settings.'
    });
  }

  const accessToken = authHeader.replace('Bearer ', '');
  console.log(`Auth header present: ${!!authHeader}, token length: ${accessToken.length}, token prefix: ${accessToken.substring(0, 10)}...`);

  try {
    const [nowPlaying, recentTracks, topTracks, topArtists] = await Promise.all([
      getCurrentlyPlaying(accessToken).catch((e) => { console.error('currently-playing error:', e.message); return null; }),
      getRecentlyPlayed(accessToken, 5).catch((e) => { console.error('recently-played error:', e.message); return []; }),
      getTopTracks(accessToken, 'short_term', 5).catch((e) => { console.error('top-tracks error:', e.message); return []; }),
      getTopArtists(accessToken, 'short_term', 5).catch((e) => { console.error('top-artists error:', e.message); return []; })
    ]);

    const mergeVars = {
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
    };

    console.log(`Spotify data fetched: now_playing=${mergeVars.has_now_playing}, recent=${mergeVars.recent_count}, top_tracks=${mergeVars.top_tracks_count}, top_artists=${mergeVars.top_artists_count}`);
    res.json(mergeVars);
  } catch (err) {
    console.error('Error fetching Spotify data:', err.message);
    res.json({
      error: true,
      error_message: 'Failed to fetch Spotify data. Token may be expired.'
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

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`trmnl-spotify-private running on port ${PORT}`);
});
