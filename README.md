# trmnl-spotify-private

A TRMNL private plugin that displays your Spotify listening stats using TRMNL-managed OAuth2.

Unlike a marketplace plugin where the server handles OAuth, this private plugin leverages TRMNL's built-in OAuth2 provider support. TRMNL handles the entire Spotify OAuth flow and token refresh. The server simply receives the access token in a polling request, fetches data from Spotify, and returns JSON merge variables.

## Features

- **Now Playing** - currently playing track (if active)
- **Recently Played** - last 5 tracks
- **Top Tracks** - your most-listened tracks (last 4 weeks)
- **Top Artists** - your most-listened artists (last 4 weeks)
- All 4 TRMNL layout sizes (full, half vertical, half horizontal, quadrant)
- **TRMNL X optimized** - responsive upsizing via `lg:` classes, extra content on larger screens, JS-based text clamping via `data-clamp`

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

The server runs on port 3006 by default (configurable via `PORT` in `.env`).

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

Click "Edit Markup" and paste the templates below into each layout tab.

## Markup Templates

### Full Layout

```liquid
{% if error %}
  <div class="layout layout--col">
    <div class="columns">
      <div class="column">
        <div class="markdown">
          <span class="title lg:title--large">Connection Required</span>
          <div class="content content--center">{{ error_message }}</div>
        </div>
      </div>
    </div>
  </div>
{% else %}
  <div class="layout layout--col gap--medium lg:gap--large">
    {% if has_now_playing %}
      <div class="item item--emphasis-2">
        <div class="meta"></div>
        <div class="content">
          <span class="title title--small lg:title--base">Now Playing</span>
          <span class="description lg:description--large" data-clamp="1" data-clamp-lg="2">{{ now_playing_track }} - {{ now_playing_artist }}</span>
          <div class="flex gap--small">
            <span class="label label--small lg:label--base label--underline" data-clamp="1">{{ now_playing_album }}</span>
            <span class="label label--small lg:label--base">{% if now_playing_is_active %}Playing{% else %}Paused{% endif %}</span>
          </div>
        </div>
      </div>
      <div class="divider"></div>
    {% endif %}
    <div class="flex flex--row">
      <div class="stretch-x">
        <span class="title title--small lg:title--base">Top Tracks (4 weeks)</span>
        {% for track in top_tracks %}
          <div class="item">
            <div class="meta"><span class="index">{{ track.index }}</span></div>
            <div class="content">
              <span class="title title--small lg:title--base" data-clamp="1">{{ track.track_name }}</span>
              <span class="label label--small lg:label--base" data-clamp="1">{{ track.artist_name }}</span>
            </div>
          </div>
        {% endfor %}
      </div>
      <div class="stretch-x hidden lg:visible">
        <span class="title title--small lg:title--base">Top Artists (4 weeks)</span>
        {% for artist in top_artists %}
          <div class="item">
            <div class="meta"><span class="index">{{ artist.index }}</span></div>
            <div class="content">
              <span class="title title--small lg:title--base" data-clamp="1">{{ artist.artist_name }}</span>
              <span class="label label--small lg:label--base" data-clamp="1">{{ artist.genres }}</span>
            </div>
          </div>
        {% endfor %}
      </div>
    </div>
  </div>
{% endif %}

<div class="title_bar">
  <span class="title">Spotify Stats</span>
</div>
```

### Half Vertical Layout

```liquid
{% if error %}
  <div class="layout layout--col">
    <span class="title title--small lg:title--base">Spotify</span>
    <span class="description">{{ error_message }}</span>
  </div>
{% else %}
  <div class="layout layout--col gap--small lg:gap--medium">
    {% if has_now_playing %}
      <div class="item item--emphasis-2">
        <div class="meta"></div>
        <div class="content">
          <span class="title title--small lg:title--base" data-clamp="1">{{ now_playing_track }}</span>
          <span class="label label--small lg:label--base" data-clamp="1">{{ now_playing_artist }}</span>
        </div>
      </div>
      <div class="divider"></div>
    {% endif %}
    <span class="title title--small lg:title--base">Top Tracks</span>
    {% for track in top_tracks limit: 4 %}
      <div class="item">
        <div class="meta"><span class="index">{{ track.index }}</span></div>
        <div class="content">
          <span class="title title--small lg:title--base" data-clamp="1">{{ track.track_name }}</span>
          <span class="label label--small lg:label--base" data-clamp="1">{{ track.artist_name }}</span>
        </div>
      </div>
    {% endfor %}
    <div class="hidden lg:visible">
      <div class="divider"></div>
      <span class="title title--small lg:title--base">Top Artists</span>
      {% for artist in top_artists limit: 3 %}
        <div class="item">
          <div class="meta"><span class="index">{{ artist.index }}</span></div>
          <div class="content">
            <span class="title title--small lg:title--base" data-clamp="1">{{ artist.artist_name }}</span>
            <span class="label label--small lg:label--base" data-clamp="1">{{ artist.genres }}</span>
          </div>
        </div>
      {% endfor %}
    </div>
  </div>
{% endif %}

<div class="title_bar">
  <span class="title">Spotify Stats</span>
</div>
```

### Half Horizontal Layout

```liquid
{% if error %}
  <div class="layout layout--col">
    <span class="title title--small lg:title--base">Spotify</span>
    <span class="description">{{ error_message }}</span>
  </div>
{% else %}
  <div class="layout">
    <div class="columns">
      <div class="column">
        {% if has_now_playing %}
          <span class="title title--small lg:title--base">Now Playing</span>
          <span class="description lg:description--large" data-clamp="1" data-clamp-lg="2">{{ now_playing_track }}</span>
          <span class="label label--small lg:label--base" data-clamp="1">{{ now_playing_artist }}</span>
          <div class="divider"></div>
        {% endif %}
        <span class="title title--small lg:title--base">Top Tracks</span>
        {% for track in top_tracks limit: 3 %}
          <div class="item">
            <div class="meta"><span class="index">{{ track.index }}</span></div>
            <div class="content">
              <span class="description lg:description--large" data-clamp="1">{{ track.track_name }}</span>
              <span class="label label--small lg:label--base" data-clamp="1">{{ track.artist_name }}</span>
            </div>
          </div>
        {% endfor %}
      </div>
      <div class="column">
        <span class="title title--small lg:title--base">Top Artists</span>
        {% for artist in top_artists limit: 3 %}
          <div class="item">
            <div class="meta"><span class="index">{{ artist.index }}</span></div>
            <div class="content">
              <span class="description lg:description--large" data-clamp="1">{{ artist.artist_name }}</span>
              <span class="label label--small lg:label--base" data-clamp="1">{{ artist.genres }}</span>
            </div>
          </div>
        {% endfor %}
        <div class="hidden lg:visible">
          <div class="divider"></div>
          <span class="title title--small lg:title--base">Recently Played</span>
          {% for track in recent_tracks limit: 2 %}
            <div class="item">
              <div class="meta"><span class="index">{{ track.index }}</span></div>
              <div class="content">
                <span class="description" data-clamp="1">{{ track.track_name }}</span>
                <span class="label label--small lg:label--base" data-clamp="1">{{ track.artist_name }}</span>
              </div>
            </div>
          {% endfor %}
        </div>
      </div>
    </div>
  </div>
{% endif %}

<div class="title_bar">
  <span class="title">Spotify Stats</span>
</div>
```

### Quadrant Layout

```liquid
{% if error %}
  <div class="layout layout--col">
    <span class="title title--small lg:title--base">Spotify</span>
  </div>
{% else %}
  <div class="layout layout--col gap--small">
    {% if has_now_playing %}
      <span class="title title--small lg:title--base" data-clamp="1">{{ now_playing_track }}</span>
      <span class="label label--small lg:label--base" data-clamp="1">{{ now_playing_artist }}</span>
    {% else %}
      <span class="title title--small lg:title--base">Top Tracks</span>
      {% for track in top_tracks limit: 3 %}
        <span class="description lg:description--large" data-clamp="1">{{ track.index }}. {{ track.track_name }}</span>
      {% endfor %}
    {% endif %}
  </div>
{% endif %}

<div class="title_bar">
  <span class="title">Spotify</span>
</div>
```

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

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/spotify` | GET | Main polling endpoint (requires `Authorization: Bearer <token>` header) |
| `/health` | GET | Health check |
| `/` | GET | Status page |

## Deployment

See `deployment/` for systemd service files and deploy scripts. The app runs on port 3006 with a deploy endpoint on port 3007.

## License

MIT
