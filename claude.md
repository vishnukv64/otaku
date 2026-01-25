# Otaku - API Response Documentation

This file contains actual API responses from various sources for reference when building new features.

## AllAnime API

### Base URL
`https://api.allanime.day/api`

### GraphQL API Structure

All requests use the format:
```
https://api.allanime.day/api?variables={encoded_variables}&query={encoded_query}
```

---

## API Response Structures

### 1. Get Anime Details (`getDetails`)

**Endpoint**: GraphQL query with `show(_id: $showId)`

**Query Fields Requested**:
- `_id`
- `name`
- `thumbnail`
- `description`
- `status`
- `score`
- `season`
- `availableEpisodes`
- `availableEpisodesDetail`
- `genres`
- `tags`

**Actual Response** (to be populated):
```json
// Response will be captured from logs and added here
```

---

### 2. Search Anime (`search`)

**Endpoint**: GraphQL query with `shows(search: $search)`

**Query Fields Requested**:
- `_id`
- `name`
- `thumbnail`
- `availableEpisodes`
- `description`
- `status`
- `score`
- `season`

**Actual Response** (to be populated):
```json
// Response will be captured from logs and added here
```

---

### 3. Discover/Popular Anime (`discover`)

**Endpoint**: Persisted query `queryPopular`

**Variables**:
- `type`: "anime"
- `size`: 20
- `dateRange`: 1 (trending) or 30 (top rated)
- `page`: page number
- `allowAdult`: false
- `allowUnknown`: false

**Actual Response** (to be populated):
```json
// Response will be captured from logs and added here
```

---

### 4. Get Episode Sources (`getSources`)

**Endpoint**: GraphQL query with `episode(showId: $showId)`

**Query Fields Requested**:
- `episodeString`
- `sourceUrls`

**Actual Response**:
```json
{
  "data": {
    "episode": {
      "episodeString": "4",
      "sourceUrls": [
        {
          "className": "text-danger",
          "priority": 5.3,
          "sourceName": "Sup",
          "sourceUrl": "https://strmup.cc/836d4aad68409",
          "streamerId": "allanime",
          "type": "iframe"
        },
        {
          "className": "",
          "priority": 4,
          "sandbox": "allow-forms allow-scripts allow-same-origin",
          "sourceName": "Mp4",
          "sourceUrl": "https://mp4upload.com/embed-2matc8sl6idx.html",
          "streamerId": "allanime",
          "type": "iframe"
        },
        {
          "className": "",
          "priority": 7.9,
          "sourceName": "Yt-mp4",
          "sourceUrl": "--504c4c484b0217...(hex-encoded)",
          "streamerId": "allanime",
          "type": "player"
        },
        {
          "className": "",
          "downloads": {
            "downloadUrl": "https://blog.allanime.day/apivtwo/clock/dr?id=...",
            "sourceName": "S-mp4"
          },
          "priority": 7.4,
          "sourceName": "S-mp4",
          "sourceUrl": "--175948514e4c4f57...(hex-encoded)",
          "streamerId": "allanime",
          "type": "iframe"
        }
      ]
    }
  }
}
```

**Key Findings**:
- **iframe sources**: Embed URLs, not direct video streams
- **player sources**: Hex-encoded URLs that need decoding
- **downloads field**: Some sources have direct download URLs
- **Hex format**: URLs start with `--` followed by hex-encoded path

---

## Field Mappings & Transformations

### Genres/Tags Field Analysis

After analyzing the actual API response, we'll document:
- Field name in API response
- Data type and structure
- Sample values
- How to map to our `MediaDetails` type

---

## Notes

- All responses are captured from the Rust backend `__fetch()` function
- Logs can be viewed when running the app in development mode
- This documentation is updated as we discover new API structures

---

# Video Player System Architecture

## Overview

Comprehensive video streaming system with HLS support, quality selection, server switching, episode navigation, and download functionality.

## Components

### 1. VideoPlayer (`src/components/player/VideoPlayer.tsx`)

Full-featured video player with:
- **HLS.js Integration**: Adaptive bitrate streaming
- **Quality Selection**: Auto, 1080p, 720p, 480p, 360p
- **Server Selection**: Switch between multiple CDN servers
- **Episode Navigation**: Next/Previous buttons with auto-play
- **Playback Controls**: Play/pause, seek, volume, fullscreen
- **Keyboard Shortcuts**:
  - `Space/K` - Play/Pause
  - `F` - Fullscreen
  - `M` - Mute
  - `Arrow Left/Right` - Seek -10/+10 seconds
  - `Arrow Up/Down` - Volume +/-
  - `N` - Next episode
  - `P` - Previous episode
- **Progress Tracking**: Saves watch position
- **Error Handling**: Automatic retry on network errors

### 2. EpisodeList (`src/components/player/EpisodeList.tsx`)

Collapsible sidebar with:
- Episode thumbnails
- Current episode indicator
- Watched status tracking
- Pagination (50 episodes per page)
- Click to switch episodes

### 3. DownloadButton (`src/components/player/DownloadButton.tsx`)

Download functionality:
- Quality/server selection dropdown
- One-click download
- Progress feedback
- Downloads to `~/Downloads/Otaku/`

### 4. DownloadManager (`src/components/player/DownloadManager.tsx`)

Download tracking UI:
- List all downloads
- Real-time progress updates
- Cancel downloads
- Open downloads folder
- Status indicators

## Backend (Rust)

### Video Proxy Commands

#### `proxy_video_request`
- Proxies video segment requests
- Supports HTTP Range requests (for seeking)
- Adds proper headers to avoid CORS
- Returns raw bytes

#### `proxy_hls_playlist`
- Fetches m3u8 playlists
- Rewrites relative URLs to absolute
- Returns modified playlist content

### Download Commands

#### `start_download`
- Initiates video download
- Streams to disk in 8KB chunks
- Tracks progress
- Returns download ID

#### `get_download_progress`
- Returns progress for specific download
- Includes: percentage, bytes downloaded, status

#### `list_downloads`
- Returns all downloads
- Auto-updates every 500ms when manager is open

#### `cancel_download`
- Cancels ongoing download
- Removes partial file

## Data Flow

### Streaming Flow
```
User clicks episode → /watch route loads
  ↓
getVideoSources(extensionId, episodeId)
  ↓
Extension queries AllAnime API
  ↓
Fetches /clock.json → Extracts HLS URLs
  ↓
Returns VideoSource[] with servers & qualities
  ↓
VideoPlayer loads HLS via proxy_hls_playlist
  ↓
Rewrites URLs to use proxy
  ↓
Video segments fetched via proxy_video_request
  ↓
HLS.js handles adaptive streaming
```

### Download Flow
```
User clicks Download button
  ↓
Selects quality & server
  ↓
startDownload(url, filename, animeTitle, episodeNumber)
  ↓
Rust backend streams video to disk
  ↓
Progress updates every chunk
  ↓
File saved to ~/Downloads/Otaku/
  ↓
Status updated to 'completed'
```

## State Management

### Player Store (`src/store/playerStore.ts`)

Persisted to localStorage:
- **Watch Progress**: `{ episodeId, currentTime, duration, lastWatched, completed }`
- **Player Settings**: `{ volume, muted, autoPlayNext, preferredQuality, preferredServer }`

Not persisted:
- Current playback state (cleared on app restart)

### Key Methods:
- `setWatchProgress(animeId, episodeId, progress)` - Save progress
- `getWatchProgress(animeId, episodeId)` - Resume playback
- `updateSettings(settings)` - Update player preferences

## Routes

### `/watch`
**Query Parameters**:
- `extensionId` - Extension to use
- `animeId` - Anime ID
- `episodeId` (optional) - Specific episode to play

**Layout**:
- Top bar: Back button, anime title, episode info
- Main area: Video player
- Right sidebar: Episode list (collapsible)

### `/downloads`
Shows the DownloadManager component in full-page mode

## File Naming

Downloads are saved with format:
```
~/Downloads/Otaku/{AnimeTitle}_EP{Number}_{Quality}.mp4
```

Example: `Demon_Slayer_EP1_1080p.mp4`

## Dependencies

### Frontend
- `hls.js` - HLS streaming support
- `@tauri-apps/api` - Tauri IPC communication
- `@tauri-apps/plugin-shell` - Open folders

### Backend
- `ureq` - HTTP client for proxying
- `tokio` - Async runtime for downloads
- `dirs` - System directories (Downloads folder)
- `tauri-plugin-shell` - Shell operations

## Security

- All video requests go through Rust backend proxy
- CORS headers handled automatically
- Download directory is user's system Downloads folder
- No direct internet access from frontend (except through proxy)

## Performance

- **HLS.js Worker**: Enabled for better performance
- **Chunk Size**: 8KB for downloads (balance between memory and speed)
- **Progress Updates**: Every chunk (smooth progress bars)
- **Playlist Caching**: HLS.js handles caching automatically

## Future Enhancements

- [ ] Subtitle support (already in VideoSources interface)
- [ ] Picture-in-Picture mode
- [ ] Playback speed control
- [ ] Screenshot capture
- [ ] Watch history UI
- [ ] Continue watching from library
- [ ] Download queue management (pause/resume)
- [ ] Multi-threaded downloads for faster speeds
