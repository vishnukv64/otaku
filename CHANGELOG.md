# Changelog

All notable changes to Otaku will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-04-30

### Fixed
- **AllAnime "No Video Sources Available"** — Two upstream changes broke streaming: (1) AllAnime rotated their `tobeparsed` AES-GCM key seed from a 16-char reversed string to `"Xot36i3lK3:v1"` (used as-is, no reversal) and prepended a 1-byte marker, shifting the IV to `raw[1..13]`; (2) the `episode`/`sourceUrls` GraphQL endpoint now requires `Referer: https://youtu-chan.com/` — any other referer (including `allmanga.to`, used by every other endpoint) returns `NEED_CAPTCHA` with an empty payload. Both layers updated; verified end-to-end against live AllAnime traffic and byte-for-byte against anipy-cli's reference plaintext.

### Added
- **Library auto-download** — Library entries can now opt in to silently download new anime episodes as soon as the release checker detects them. Picks the highest-resolution source available, runs best-effort, and surfaces failures to the existing notification flow without disrupting the release checker. New migration `024_library_auto_download.sql` adds the `library.auto_download` flag plus a partial index for opted-in rows.
- **Release Radar group cards** — New episode notifications now collapse into per-show group cards (`ReleaseRadarGroupCard`) in both the desktop and mobile notification centers, replacing the previous one-row-per-episode list.
- **Completion Predictor** — New stats panel that projects finish dates for currently-watching shows based on watch cadence.
- **Player playback speed** — 0.5x / 0.75x / 1x / 1.25x / 1.5x / 1.75x / 2x speed selector with `[` and `]` keyboard shortcuts to step down/up.
- **Auto-delete-on-watch** — Optional flow that deletes the local downloaded file after an episode is fully watched, with a success toast.

### Changed
- **DownloadManager UI polish** — Layout, status indicators, and progress feedback updates aligned with the new auto-download/auto-delete flows.
- **Recommendations / tags / library queries** — Internal SQL refactors backing the new features above; no user-visible behaviour change for existing flows.

## [1.3.1] - 2026-04-19

### Fixed
- **Adaptive HLS downloads always fell back to master URL** — When variant resolution failed, `resolveAdaptiveToVariant` silently returned the master `.m3u8` URL, reintroducing the 1.3.0 bug of saving playlist text as `.mp4`. Return type is now `{ url, resolution } | null` so callers explicitly surface failure with "Could not resolve a concrete HLS variant" instead of silently saving a broken file.
- **Corrupted offline copies kept being replayed** — Watch page now stats the on-disk episode via the new `get_local_file_size` command and ignores files under 1 MB (leftovers from the pre-1.3.0 playlist-as-video bug), falling through to streaming instead of crashing the player on open.

### Changed
- **Download quality menu lists real HLS variants** — Instead of showing one opaque entry per server, opening the download menu now fetches each adaptive source's master playlist and expands it into per-resolution options (360p / 480p / 720p / 1080p), deduped by `(server, resolution)`. A "Resolving downloadable variants..." spinner covers the fetch window, and an explicit "No downloadable variants available" empty state replaces silent-disable.

### Added
- **`get_local_file_size` Tauri command** — Thin async wrapper over `tokio::fs::metadata(...).len()` so the frontend can validate local media before use.
- **`listAdaptiveVariants` helper** (`src/utils/hlsResolve.ts`) — Extracted from `resolveAdaptiveToVariant` for reuse by the download menu.

## [1.3.0] - 2026-04-19

### Added
- **Multi-resolution streaming & downloads** — Videos can now be watched and downloaded at specific resolutions (360p / 480p / 720p / 1080p) rather than a single opaque stream per provider. Modelled on anipy-cli's proven approach: each `VideoSource` carries an explicit `resolution` (height in pixels), and a shared selector picks the best match with graceful fallback to highest available.
- **`resolution`, `referrer`, `subtitles` fields on `VideoSource`** — New optional fields on both TS and Rust sides. `resolution === undefined` on HLS master playlists signals "adaptive" (HLS.js handles variant switching); fixed MP4 sources carry a concrete integer height.
- **WixMP multi-quality expansion** — `repackager.wixmp.com` URLs with `,480p,720p,1080p,` path segments are now split into distinct per-resolution MP4 entries, each selectable independently.
- **Fast4speed provider default** — Sources under `tools.fast4speed.rsvp` default to 1080p resolution (matches anipy-cli's convention).
- **Subtitle metadata capture** — Per-source subtitle tracks from AllAnime's `clock.json` (`links[].subtitles`) are now parsed and attached to each `VideoSource`. Full playback/download subtitle UX deferred.
- **Custom referrer plumbing** — Per-source `Referer` header requirement (needed by some CDNs) is captured at the extension layer and available to downstream requests.
- **`pickSource` selector utility** (`src/utils/pickSource.ts`) — Single source of truth for quality selection. Semantics mirror anipy-cli's `Anime.get_video`: exact match → fall back to best available. Reused by player load + download pipeline.
- **`resolveAdaptiveToVariant` JIT resolver** (`src/utils/hlsResolve.ts`) — Fetches an HLS master playlist, parses `#EXT-X-STREAM-INF` variants, and returns the concrete variant URL for a chosen resolution. Used when downloading adaptive HLS sources so the saved file is video, not a `.m3u8` text file.

### Changed
- **Player quality selector** — Quality dropdown now unifies HLS variants (discovered at manifest parse time) and fixed MP4 resolutions (populated from sources) into a single deduped list. The player reads `playerStore.preferredQuality` on load, applies it via `pickSource`, and locks the HLS variant when preference is non-Auto.
- **Preferred quality persistence** — `playerStore.preferredQuality` is now actually applied on episode load (previously ignored; player always started in 'Auto'). Legacy string values (`"720p"`, `"Auto"`) continue to work via defensive parsing.
- **Download default matching** — Download options dialog highlights the default-quality entry via exact `${resolution}p` matching instead of fragile substring checks.
- **AllAnime extension `getSources`** — Now populates `resolution`, `referrer`, and per-source `subtitles` on every emitted source, including clock.json, direct-hex, and plain HTTP fallback paths.

### Fixed
- **HLS master playlist download bug** — Downloading an adaptive HLS source previously saved the `.m3u8` manifest text file (≈few KB), not the actual video. Now resolves to a concrete variant URL just-in-time before invoking the Rust download pipeline.
- **Quality selection with HLS + non-HLS mixed sources** — Switching between a server with adaptive HLS and one with fixed MP4 variants no longer loses the user's resolution preference.
- **Duplicate sources in download menu** — Dedup by `(server, resolution)` so clock.json returning the same variant twice no longer shows up as two identical options.

### Maintenance
- Shared quality/resolution parsing via `parseQualityPreference` so every call site migrates old string values the same way.
- No new npm/cargo dependencies — HLS master parsing is a minimal text-level scan (no full m3u8 library required).

## [1.2.1] - 2026-04-19

### Fixed
- **AllAnime "No video source available" error** — AllAnime rolled out response encryption that wraps the real payload in an encrypted `tobeparsed` blob, breaking the old `data.episode.sourceUrls` accessor and leaving every episode with zero sources. Added Rust-side AES-256-GCM decryptor exposed to the extension sandbox as `__decryptAllanime`, with transparent fallback for unencrypted responses.
- **Clock URL resolution** — Previously hard-dropped all `/apivtwo/clock` sources (comment claimed they 404); these are actually the primary streaming endpoints. Now rewritten to `/clock.json?id=...`, fetched, and unwrapped into real HLS/MP4 URLs.
- **Hex decoder correctness** — Replaced fragile 70-entry lookup map with the canonical `byte XOR 56` algorithm used by ani-cli/anipy-cli. Old code silently dropped unmapped bytes whenever AllAnime introduced new characters in URL paths.
- **Error message surfacing** — `rquickjs::Error::Exception` was swallowing real JS error details ("Exception generated by QuickJS" was shown instead of the actual message). Wrapped extension eval with `CatchResultExt::catch` so JS exceptions now log with full message + stack.
- **Tauri error display** — Watch page now extracts real error messages from Tauri's `Result<T, String>` rejections instead of falling back to a generic "Failed to load video sources" for every failure.

### Added
- **WixMP multi-quality expansion** — Repackager URLs like `.../,480p,720p,1080p,/mp4/file.mp4.urlset/...` are now split into individual per-resolution MP4 streams so users get proper quality selection.
- **Provider priority ordering** — Sources are now tried in the `Default, Yt-mp4, S-mp4, Luf-mp4, Sak, Kir, Ak` order (matches ani-cli) for reliability, with per-source skip reasons logged.

### Maintenance
- Added `aes-gcm`, `sha2`, `base64` crates for `tobeparsed` decryption.
- Defensive `try/catch` hardening across extension JS so broken `__log` can never mask the real error.
- Extracted AllAnime encryption key to named `ALLANIME_KEY_SEED` constant with runbook comment for future key rotations (check anipy-cli / ani-cli / jerry for updates).

## [1.2.0] - 2026-04-15

### Added
- **Recommendation Engine** — TF-IDF genre scoring, per-series similarity ranking, recency decay, and content-based content recommendation engine.
- **Jikan-Powered Discovery Carousels** — Genre-weighted discover carousels integrated into the home page; `RecommendationCarousel` and `SimilarToCarousel` components.
- **Post-Completion Recommendations** — Media detail modal surfaces similar titles after an anime is finished.
- **Thumbs Up/Down Feedback Loop** — Users can rate recommendations; feedback personalizes future suggestions. Buttons wired into the media detail modal with visual active/response states.
- **Anime Browse Search Bar** — Search input on the anime browse page.
- **Player Poster / Thumbnail** — Poster artwork shown before playback starts; anime cover used as fallback for episodes missing their own thumbnail.
- **Mark Watched Button** — Added to the episode selection modal for quick progress marking.
- **Stats Dashboard Expansion** — 13 new analytics sections with grouped navigation.
- **Downloaded Video Obfuscation** — XOR obfuscation for downloaded video files on disk.

### Changed
- **Recommendations limited to anime** — Filters out manga/manhwa from recommendation results.
- **Homebrew Cask Migration** — Moved to dedicated tap repo; update instructions in README.

### Fixed
- **Player auto-delete timing** — Downloaded episodes now auto-delete only after leaving the player, with a 5-minute cool-down to avoid deleting files the user might immediately re-watch.
- **Modal status display** — Correctly respects `on_hold` and `plan_to_watch` statuses.
- **Feedback button state** — Thumbs up/down buttons now visually respond to clicks and persist selection.
- **Feedback migration registration** — Feedback table migration was registered in the runner; suppressed `dead_code` warnings.
- **Stats donut offsets** — Precompute segment offsets without array mutation (eliminates a subtle bug in donut chart rendering).

### Maintenance
- Recommendation engine: backend TF-IDF scoring module, Tauri command wrappers and TypeScript types.
- Prettier-reformatted media detail modal components.
- Recommendation design spec and implementation plan docs added under `docs/`.

## [1.1.0] - 2026-04-10

### Added
- **Watch History Page** — Full history page with timeline and series views, unified watch/read tracking
- **Activity Statistics Dashboard** — Charts, genre breakdowns, watch streaks, and daily activity tracking
- **History & Stats Navigation** — New nav links for History and Stats pages
- **History & Stats Backend** — SQLite modules for unified timeline, series queries, summary stats, genre analysis, and streak calculations
- **Recharts Integration** — Activity chart with period toggles (7D/30D/90D/All)

### Changed
- **Major UI Overhaul** — Redesigned browse, manga reader, and mini player; enhanced TopNav and media modals with enrichment tabs
- **AllAnime API Transport** — Switched all API calls from GET to POST with JSON body to bypass CloudFlare WAF 403 blocks
- **Extension Fetch Interceptor** — Auto-converts extension GET requests to `api.allanime.day` into POST transparently at the Rust transport layer
- **System Stats Relocated** — Moved system stats from standalone page to Settings developer section

### Fixed
- **CloudFlare 403 Blocks** — Added Origin, Content-Type, Accept headers and updated User-Agent to Firefox 131 for all AllAnime requests
- **PiP Bluetooth Audio** — Added MediaSession API for proper audio routing in Picture-in-Picture mode
- **Release Checker Reliability** — Prevent stuck checks, add timeouts, filter non-airing media from release checks
- **Stats Query Bugs** — Simplified stats queries, fixed Jikan page parameter issue, removed incorrect `localtime` modifier from SQLite DATE() calls
- **Activity Chart Loading** — Resolved perpetual loading spinner and 'All' time period loading issue
- **Stats Page Styling** — Polished with color differentiation, animations, accents, and app design language alignment

### Security
- Updated vite 6.4.1 → 6.4.2 (arbitrary file read via WebSocket)
- Updated dompurify 3.3.1 → 3.3.3 (mutation-XSS, prototype pollution)
- Added pnpm overrides for picomatch, minimatch, rollup, flatted, ajv, brace-expansion (22 vulnerabilities → 0)

### Maintenance
- Resolved all CI lint errors: WebKit PiP `any` types → proper interface, unused catch bindings, static component-in-render, setState-in-effect
- TypeScript types and command wrappers for history and stats Tauri commands

## [1.0.0] - 2026-02-18

### Breaking Changes
- **Jikan API Migration** - Primary metadata source migrated from AllAnime to Jikan (MyAnimeList)
  - All anime and manga metadata (titles, descriptions, scores, genres, status) now fetched from MAL via Jikan API
  - AllAnime is now used **only** for video streaming sources and manga chapter images
  - New `src-tauri/src/jikan/` module with dedicated client, types, and commands
- **Route Parameter Changes** - Frontend routes now use `malId` URL parameter instead of `extensionId + animeId`
  - `/watch?malId=...` replaces `/watch?extensionId=...&animeId=...`
  - `/read?malId=...` replaces `/read?extensionId=...&animeId=...`
  - Old routes are incompatible — bookmarks and saved links from v0.x will not work
- **Database Schema Migration** - 8 new SQLite migrations (014–021)
  - `discover_cache` table for offline-first browsing (migration 014)
  - `id_mappings` table for MAL ID ↔ AllAnime ID bridge cache (migration 015)
  - `migration_archive` table for auditing migrated entries from old format (migration 017)
  - `discover_cache` TTL column for stale-while-revalidate caching (migration 018)
  - `id_mappings` gains `match_score` column for confidence tracking (migration 019)
  - Multiple cache-clearing migrations (016, 019, 020, 021) to re-resolve IDs as matching improved
- **AllAnime Bridge System** - New `jikan/bridge.rs` maps MAL IDs to AllAnime IDs
  - Direct GraphQL search against AllAnime API with inline queries (not persisted query hashes)
  - Multi-signal title similarity scoring with length-ratio awareness
  - Year and episode count validation to prevent wrong-show matches
  - Results cached in SQLite `id_mappings` table with confidence scores
  - Stale mapping recovery when video sources fail

### Added
- **Migration Screen** - In-app data migration UI when upgrading from v0.x
  - Animated progress indicator with embla-carousel wheel gestures
  - Archives old AllAnime-keyed data and re-maps to MAL IDs
  - Shows migration status per entry (matched, archived, failed)
- **Mobile Support & iOS Build Pipeline** - Full responsive mobile layout
  - Bottom tab bar navigation for mobile devices
  - Mobile-optimized hero section (`MobileHeroSection` component)
  - Mobile notification center with slide-up sheet
  - `useMobileLayout` hook for responsive breakpoint detection
  - `platform.ts` utilities for platform-specific behavior
  - iOS capabilities configuration and build workflow
- **Onboarding Flow** - First-launch welcome experience
  - Welcome page with feature highlights
  - Setup wizard for initial configuration
  - Step indicator and feature cards
  - Themed in app's red and black color scheme
- **Discover Caching** - Instant page loads with offline-first browsing
  - Caches browse/search results in SQLite with configurable TTL (30min default)
  - Stale-while-revalidate pattern: shows cached data immediately, refreshes in background
  - Separate cache keys per category (trending, seasonal, top-rated)
- **Media Details & Episode Caching** - Reduced API calls for previously viewed content
  - Caches full media details and episode lists
  - Background revalidation for stale entries
- **Image Proxy System** - Reliable image loading for hotlink-protected sources
  - `useProxiedImage` hook routes remote images through Rust backend
  - `proxy_image_request` Tauri command adds required `Referer` headers
  - Fixes manga page images that were blocked without proper headers
- **Jikan Query Hook** (`useJikanQuery`) - React hook for Jikan API integration
  - Handles loading states, errors, and caching
  - Type-safe responses matching Jikan API structures
- **BottomSheet UI Component** - Reusable slide-up sheet for mobile interactions
- **Continue Reading Fix** - Reading progress properly persists when completing chapters

### Changed
- **VideoPlayer Refactored** - Improved state management and user experience
  - Uses episode index for next episode logic instead of episode ID parsing
  - Better error recovery and loading states
- **Episode Sorting** - Enhanced sorting and retrieval logic for both anime and manga
  - Handles mixed numeric/special episode numbering
  - Proper ordering for decimal episodes (e.g., 12.5)
- **AllAnime Extensions** - Updated to work with bridge-resolved IDs
  - Manga extension refactored for Jikan-first metadata flow
  - Lazy loading: AllAnime extension only loaded when needed for streaming
- **Release Checker** - Updated for Jikan API compatibility
- **Notifications** - Adapted for MAL-based media identification
- **Settings Page** - Mobile-responsive layout improvements

### Fixed
- **Landing Page Android Support** - Android download option always visible on landing page
  - Android OS detection for mobile visitors (serves APK as primary download)
  - Fallback to GitHub releases page when APK asset is not yet available
  - Android platform link shown to all desktop visitors alongside Windows/macOS/Linux
  - Updated meta tags, hero description, and feature cards for cross-platform messaging
- **Landing Page Version Badge** - Now dynamically reads version from package config
- **ESLint Errors** - Resolved linting issues for CI pipeline
- **Continue Reading Section** - Fixed chapter completion removing progress entries

## [0.1.17] - 2026-02-06

### Added
- **API Status Indicator** - Real-time connectivity monitoring in the top navigation
  - Subtle colored dot showing API health (green=online, red=offline, yellow=partial)
  - Popover with detailed status for anime and manga endpoints
  - Updates automatically as you browse (event-driven, not polling)
  - Response time and result count display
- **Release Check Stop Button** - Ability to halt ongoing release checks
  - Stop button in release check overlay to cancel long-running checks
  - Dismiss button to hide overlay while check continues in background
- **Release Notification System V2** - Redesigned multi-signal detection
  - Detects new releases via episode number, ID, and count signals
  - Status normalization for better API compatibility
  - Smart scheduling with configurable intervals
  - Debug logging for troubleshooting

### Fixed
- **UI Blocking During Release Check** - Release checks no longer freeze the interface
  - Moved to non-blocking background processing
  - Progress updates without interrupting browsing
- **Tags Popup Positioning** - Tag selector now correctly positions next to the button
  - Added scroll and resize listeners for dynamic repositioning
  - Uses requestAnimationFrame for accurate layout calculation
- **Anime Details Loading** - Fixed 400 errors when loading anime details

## [0.1.16] - 2026-02-04

### Added
- **Export/Import & Auto-Backup** - Complete data portability and protection
  - Export library, watch progress, and settings to JSON backup file
  - Import backups to restore data on new installations
  - Auto-backup feature with configurable intervals (daily, weekly, monthly)
  - Backup files stored in system-appropriate location
- **Tag System for Library Management** - Organize your collection with custom tags
  - Create, edit, and delete custom tags with color coding
  - Assign multiple tags to anime and manga entries
  - Filter library by tags for quick access
  - Bulk tag operations from library view
- **Release Check Progress Overlay** - Visual feedback during release checks
  - Shows progress when checking for new episodes/chapters
  - Displays current item being checked
  - Non-blocking overlay that doesn't interrupt browsing

### Changed
- **Landing Page Interface Section Redesign** - Enhanced visual messaging
  - Strikethrough pain points: "Domain juggling", "Ads & pop-ups", "Broken links"
  - Elegant cursive "pure and clean" highlight using Playfair Display font
  - New tagline: "Uninterrupted watching & reading — the way it should be"
- **Improved Episode Date Handling** - Better next episode countdown display
  - Enhanced MediaDetailModal and NextEpisodeCountdown components
  - More accurate date parsing and display
- **GitHub Pages Deployment** - Landing page now auto-deploys via GitHub Actions

### Fixed
- **ESLint Warnings** - Addressed multiple linting issues across codebase
- **React Hook Dependencies** - Fixed missing and incorrect hook dependencies

### Removed
- **Cache Management** - Removed cache management functionality and related components
  - Simplified settings page
  - Removed unused cache-related code

## [0.1.15] - 2026-02-02

### Removed
- **YouTube Trailer Functionality** - Removed YouTube iframe embeds from hero section
  - YouTube blocks embeds from `tauri://` protocol origins in production builds (Error 153)
  - Hero section now always displays cover image instead of trailers
  - Simplified component from 244 to 126 lines of code
  - Removed trailer-related state management and effects
  - Removed auto-mute on scroll functionality
  - Removed multi-trailer navigation controls

### Fixed
- **404 Page Navigation** - Fixed "Home" button link from `/home` to `/` to match actual route structure

### Changed
- Homepage hero section now consistently shows high-quality cover images
- Removed `autoplayTrailers` setting usage (no longer needed)
- Simplified auto-rotation logic on home page (10-second intervals)

## [0.1.14] - 2026-01-31

### Added
- **YouTube Trailer Autoplay** - Homepage hero section now autoplays anime trailers
  - Direct YouTube iframe embed for maximum compatibility
  - Plays with sound by default (browser permitting)
  - Auto-mutes when scrolling down past hero section
  - Auto-unmutes when scrolling back up to hero
- **Multi-Trailer Navigation** - Cycle through multiple trailers when available
  - Left/right arrow buttons to switch between trailer options
  - Shows current trailer number (e.g., "Trailer 1 of 3")
  - Gracefully handles unavailable/private/geo-blocked videos
  - User can manually find working trailer if first one fails
- **Enhanced Extension Data** - AllAnime extension now returns all available trailer video IDs
  - Tries multiple trailer sources for better reliability
  - Returns comma-separated list of video IDs from prevideos array

### Changed
- Homepage hero section now prioritizes showing trailers over static cover images when available
- Simplified trailer implementation using native YouTube embeds (removed complex yt-dlp dependencies)

### Technical
- Removed yt-dlp crate dependency for simpler architecture
- Removed Invidious API integration attempts
- Uses standard YouTube iframe embed with URL parameters for control
- Intersection Observer API for scroll-based mute/unmute

## [0.1.13] - 2026-01-31

### Added
- **NEW Episode Badge** - Notifies when new episodes are available for anime you're tracking
  - Only shows for currently airing anime (not finished series)
  - Appears when latest episode hasn't been watched yet
  - Subtle glass-morphism design with emerald color scheme
  - Automatically disappears after watching the new episode
- **Smart Watch Button** - Intelligently determines which episode to play
  - "Resume EP X" for partially watched episodes
  - "Continue EP X" for next unwatched episode
  - "Watch Latest EP X" when all episodes are watched
  - Special emerald gradient for new episode releases
- **Smart Library Status Display** - Shows actual progress instead of manual status
  - Displays "Watching" if you haven't watched all available episodes
  - Displays "Reading" if you haven't read all available chapters
  - Shows actual library status only when fully caught up
  - Works for both anime and manga modals

### Changed
- **Redesigned Badge System** - Cleaner, priority-based badge layout
  - Maximum of 2 badges per card (NEW on left, status on right)
  - Priority order: Favorite > Watching/Reading > Library Status > Tracking
  - Reduced visual clutter while maintaining all information
  - Larger badge icons (14px) with better shadows for visibility

### Fixed
- **TypeScript Error** - Fixed `current_time` property name mismatch in watch.tsx
- **NEW Badge Persistence** - Badge now disappears after watching new episodes
  - Added visibility-based refresh to update watch progress
  - Uses episode watch history for accurate detection
- **NEW Badge on Finished Anime** - No longer shows on completed series
  - Only appears for "Releasing", "Ongoing", or "Airing" anime
  - Properly filters based on anime status


## [0.1.12] - 2026-01-30

### Added
- **Immersive Video Player** - Full immersive viewing experience
  - TopNav and Footer automatically hidden on watch/read routes
  - All UI (title bar, controls, cursor) auto-hides after 2 seconds of mouse inactivity
  - Works in both windowed and fullscreen modes
- **Episode Dropdown Auto-Scroll** - Episode list now scrolls to currently playing episode when opened

### Changed
- Video player controls now use document-level mouse tracking for more reliable auto-hide

## [0.1.11] - 2026-01-30

### Added
- **Custom 404 Page** - Friendly "Page Not Found" page with navigation options
- **Individual Episode Downloads** - Download button on hover for each episode card
- **Clear Cancelled Downloads** - Button to clear all cancelled downloads at once
- **Dismiss Cancelled Downloads** - X button on each cancelled download to remove from list

### Fixed
- **Release Notifications Not Working** - Fixed status filter to include 'Releasing' anime/manga (was only checking 'Ongoing')
- **Release Tracking Initialization** - Now properly initializes tracking when adding media to library
- **Existing Library Items** - Uses upsert pattern to create tracking records for existing items
- **Manga Notification Links** - Fixed "Read Now" button navigating to wrong route
- **Old Notification Routes** - Added migration handler for legacy notification routes

### Changed
- Episode cards now show small download/delete buttons at top-right on hover
- Downloaded badge fades on hover to reveal delete button

## [0.1.10] - 2026-01-30

### Added
- **Custom Download Location** - Set a custom folder for downloads in Settings
  - Downloads persist across app restarts (saved to database)
  - Works for both anime episodes and manga chapters
  - "Open Folder" button opens the correct custom location
- **Pause/Resume Downloads** - Pause and resume ongoing downloads
- **Play from Downloads** - Play button in Downloads Manager to watch downloaded episodes
- **Info Buttons** - Quick info buttons on Continue Watching/Reading sections
- **Offline Mode Toast** - Shows "Offline Mode" toast when playing downloaded content
- **NSFW Content Filtering** - Enhanced filtering across all media components

### Changed
- **Max Concurrent Downloads** increased to 10
- **Card Hover Effects** - Improved popover effects on home page media cards
- **Settings Dropdowns** - Custom dropdown component for better cross-platform consistency
- **Manga Reader** - Disabled arrow keys and page numbers in vertical/webtoon modes
- **Double Page Mode** - Fixed fit-to-width and original size modes

### Fixed
- Navigation bar z-index to prevent card overlays
- Play button in Downloads Manager navigating to wrong episode
- Duplicate episode text in video player ("Episode 3 - Episode 3")
- Update notification flow - download button works after clicking notification link
- Browse downloads location dialog (added dialog:default permission)
- Downloads using custom location from settings
- Video player and manga reader reading from custom download locations

## [0.1.9] - 2026-01-29

### Added
- **Winter 2026 Season Tab** on Anime page with full season listing
  - Sorted by rating (highest to lowest)
  - Infinite scroll pagination
  - SSE streaming for progressive loading
- **Season anime caching** (15-minute TTL) for improved performance
- **"Last Aired" display** on media cards and detail modal for airing anime
- Favorite toggle button in media detail modal

### Fixed
- **Home page categories now show correct content**:
  - "Hot Today" - Daily trending anime (was showing same data as other sections)
  - "New Episodes" - Actually recently updated anime with new episode releases
  - "All-Time Classics" - Top-rated anime sorted by score
- Winter 2026 tab loading issue caused by SSE listener being prematurely unsubscribed

### Changed
- Removed Winter 2026 preview from Browse tab (now has dedicated tab)
- Home page section titles updated for clarity

## [0.1.8] - 2026-01-29

### Added
- **Notification Center** with bell icon in top navigation
  - Tabbed interface separating "Releases" and "All" notifications
  - Notification persistence to database
  - Mark as read, dismiss, and clear all functionality
- **Release Check System** for tracking new episodes/chapters
  - Background periodic checks for ongoing anime and manga
  - Configurable check intervals (6h, 12h, 24h, 48h)
  - Manual "Check Now" option
  - Notifications with direct links to watch/read new content
- Ephemeral toast notifications for transient messages (resuming playback)

### Changed
- "Resuming playback" messages now show as ephemeral toasts instead of persisted notifications

### Fixed
- Release workflow now accepts version input with or without 'v' prefix

## [0.1.7] - 2026-01-29

### Added
- Comprehensive manga reader with vertical scroll and page-by-page reading modes
- Offline manga support with chapter downloading and caching
- Reading progress sync and bookmarking
- Manga search and discovery features
- UI enhancements and polish

### Documentation
- Added xattr command instructions for macOS Gatekeeper bypass

## [0.1.6] - 2026-01-28

### Fixed
- Enable createUpdaterArtifacts for updater JSON generation

## [0.1.5] - 2026-01-28

### Added
- 4K display support

### Fixed
- Updater signing configuration

## [0.1.4] - 2026-01-28

### Added
- In-app update system with automatic version checking
- Download progress tracking for updates with real-time feedback
- Changelog/release notes display in update notifications
- One-click install and restart for updates
- Signed updates for enhanced security

## [0.1.3] - 2026-01-26

### Fixed
- Remove Linux ARM64 build from release workflow due to compatibility issues

## [0.1.2] - 2026-01-25

### Fixed
- Use native ARM runner instead of cross-compilation for macOS builds

## [0.1.1] - 2026-01-24

### Added
- Security scanning and pre-commit hooks
- Updated README with new screenshots

### Fixed
- Route tree generation step for CI typecheck
- ESLint errors and GitHub Actions workflow issues

## [0.1.0] - 2026-01-23

### Added
- Initial release of Otaku
- Netflix-like anime browsing interface
- Video player with HLS streaming support
- Quality and server selection
- Episode navigation with auto-play next
- Download manager for offline viewing
- Watch history and progress tracking
- Library management with favorites
- Continue watching section
- Search functionality
- Real-time system stats monitoring
- Application logs viewer
- Customizable settings
  - Theme preferences
  - Player settings (quality, volume, playback speed)
  - Download configuration
  - Grid density options
