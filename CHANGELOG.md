# Changelog

All notable changes to Otaku will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
