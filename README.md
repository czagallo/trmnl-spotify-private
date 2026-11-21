# trmnl-spotify-private

A TRMNL private plugin that displays your Spotify listening stats using TRMNL-managed OAuth2.

Unlike a marketplace plugin where the server handles OAuth, this private plugin leverages TRMNL's built-in OAuth2 provider support. TRMNL handles the entire Spotify OAuth flow and token refresh. The server simply receives the access token in a polling request, fetches data from Spotify, and returns JSON merge variables.

## Features

- **Now Playing** - currently playing track (if active)
- **Recently Played** - last 5 tracks
- **Top Tracks** - your most-listened tracks (last 4 weeks)
- **Top Artists** - your most-listened artists (last 4 weeks)
- All 4 TRMNL layout sizes (full, half vertical, half horizontal, quadrant)
- **TRMNL X optimized** - extra content via `lg:` classes and larger type in TRMNL X portrait via `lg:portrait:` classes

## How It Works

```
TRMNL Device <---> TRMNL Server <---> Your Server <---> Spotify API
                   (OAuth2 +          (polling
                    token refresh)     endpoint)
```

1. You create a private plugin in TRMNL with the **Polling** strategy
2. You enable **OAuth2** with the `spotify` provider from TRMNL's library
3. TRMNL handles the Spotify authorization flow and token refresh
4. When TRMNL polls your server, it sends the Spotify access token in the `Authorization` header
5. Your server calls Spotify's API and returns flat JSON merge variables
6. TRMNL renders the data using Liquid templates in the markup editor

## Prerequisites

- [TRMNL](https://trmnl.com) device with Developer add-on
- [Spotify Developer](https://developer.spotify.com/dashboard) application
- Node.js 18+

## Server Setup

```bash
git clone https://github.com/czagallo/trmnl-spotify-private.git
cd trmnl-spotify-private
npm install
cp .env.example .env
npm start
```

The server runs on `127.0.0.1:3006` by default (`PORT` and `HOST` in `.env`). It is meant to sit
behind a tunnel or reverse proxy on the same host; set `HOST=0.0.0.0` only if the proxy runs on
another machine.

Responses are cached in memory per access token (keyed by a SHA-256 of the token, never the
token itself; at most 100 entries) for `CACHE_TTL_MS` (default 60000), so TRMNL polling and
retries cannot push the plugin into Spotify's rate limits. A 429 from Spotify is cached for its
`Retry-After` (at most 5 minutes).

## TRMNL Plugin Setup

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Set the redirect URI to: `https://trmnl.com/plugin_settings/oauth2/callback`
4. Note your **Client ID** and **Client Secret**

### 2. Create the Private Plugin

1. In TRMNL, go to Plugins > search "Private Plugin"
2. **Name**: `Spotify Stats` (or whatever you like)
3. **Strategy**: `Polling`
4. **Polling URL**: `https://your-server.com/api/spotify`
5. **Polling Headers**: `authorization=Bearer ##{{ access_token }}`

### 3. Enable OAuth2

1. On the plugin settings page, enable **OAuth2**
2. Select provider: `Spotify (OAuth)`
3. Enter your Spotify app's **Client ID** and **Client Secret**
4. Set scopes: `user-read-currently-playing user-read-recently-played user-top-read`
5. Save and authorize

### 4. Add Markup Templates

Click "Edit Markup" and paste each file from `templates/` into the matching layout tab:

| File | TRMNL markup tab |
|------|------------------|
| `templates/full.liquid` | Full |
| `templates/half_horizontal.liquid` | Half Horizontal |
| `templates/half_vertical.liquid` | Half Vertical |
| `templates/quadrant.liquid` | Quadrant |

Each template handles now playing, nothing playing (shows the last played track), no listening
data yet, and the error response. They use TRMNL framework classes only; TRMNL X (`lg:`) gets
more content (a Recently played column in full, a third track in half horizontal, top artists in
half vertical, more tracks in quadrant) and TRMNL X portrait (`lg:portrait:`) uses larger type.
The quadrant is the same size in both orientations on TRMNL X, so it has no portrait step.
Only black and white are used (no grey fills or grey text, which dither badly on 1-bit panels). Single-line text is truncated with a CSS ellipsis rather than `data-clamp`, which mis-measured
some list items in testing.

## API Response Format

The polling endpoint returns flat JSON merge variables:

```json
{
  "has_now_playing": true,
  "now_playing_track": "Bohemian Rhapsody",
  "now_playing_artist": "Queen",
  "now_playing_album": "A Night at the Opera",
  "now_playing_is_active": true,
  "recent_tracks": [
    { "track_name": "...", "artist_name": "...", "album_name": "...", "played_at": "...", "index": 1 }
  ],
  "recent_count": 5,
  "top_tracks": [
    { "track_name": "...", "artist_name": "...", "album_name": "...", "index": 1 }
  ],
  "top_tracks_count": 5,
  "top_artists": [
    { "artist_name": "...", "genres": "rock, classic rock", "index": 1 }
  ],
  "top_artists_count": 5,
  "updated_at": "2026-02-17T12:00:00.000Z"
}
```

### Errors

All errors are returned with HTTP 200 (TRMNL requirement) as `{ "error": true, "error_kind": ..., "error_message": ... }`:

| `error_kind` | Cause |
|---|---|
| `token_expired` | Spotify answered 401 |
| `forbidden` | Spotify answered 403 (usually missing OAuth scopes) |
| `rate_limited` | Spotify answered 429 |
| `unavailable` | All four Spotify requests failed (network error, timeout) |

The server logs only HTTP status codes, never tokens or Spotify response bodies.

## Tests

```bash
npm test
```

Runs the `node --test` suite in `test/` (fixtures in `test/fixtures/`, Spotify requests are
injected, no network) and then the start-up smoke test in `scripts/smoke-test.sh`.

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/spotify` | GET | Main polling endpoint (requires `Authorization: Bearer <token>` header) |
| `/health` | GET | Health check |
| `/` | GET | Status page |

## Deployment

Pushes to `main` deploy through GitHub Actions (`.github/workflows/deploy.yml`), which runs
`deployment/deploy.sh` on the server. The systemd unit is `deployment/trmnl-spotify-private.service`
(port 3006, bound to 127.0.0.1).

## License

MIT
