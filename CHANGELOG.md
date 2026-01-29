# Changelog

All notable changes to Otaku will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
