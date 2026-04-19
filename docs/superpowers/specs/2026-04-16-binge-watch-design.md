# Binge Watch — Synchronized Co-Viewing Design

## Overview

Add a "Binge Watch" feature to Otaku that lets users watch anime episodes together in sync with remote friends, similar to Discord Watch Together or Teleparty. Each viewer streams the video independently from their own Otaku install; only tiny control messages (play, pause, seek, episode change, chat) cross the network via WebRTC peer-to-peer DataChannels. A self-hosted signaling server (Rust + Axum) exchanges WebRTC offers/answers; a self-hosted coturn instance provides TURN fallback for users behind restrictive NATs.

This feature is internet-by-default, opt-in, and built on existing Otaku primitives (axum HTTP server, Tauri commands, Zustand stores, VideoPlayer component). Voice chat, video chat, and manga co-reading are explicitly out of scope for V1.

## Goals

- **Host a room** from the player in under 5 seconds, with a shareable 6-character code.
- **Join a room** by pasting a code or opening a deep link; guest's Otaku automatically loads the same anime/episode.
- **Keep all clients within 500 ms playback drift** without audible/visible stutter.
- **Work across Windows, macOS, Linux, and Android** with a single WebRTC implementation.
- **Stay local-first in spirit:** no accounts, no persistent user identity, self-hosted infrastructure only.

## Non-Goals (V1)

- Voice chat or video chat (WebRTC audio/video tracks)
- Emoji reactions overlay on video
- Shared cursor, scene highlights, or annotations
- Recurring "watch clubs" with persistent membership
- Mobile push notifications for incoming invites
- Manga co-reading (same architecture, separate surface — V2+)
- Desktop-only keyboard shortcuts for room controls (stretch goal if time permits)
- **Host hand-off / host election:** if the host disconnects, the room ends. V2+ will add "promote eldest guest to host" with proper election protocol. This keeps V1's room lifecycle simple and unambiguous.

## Architecture

### Component diagram

```
┌─────────────┐         ┌─────────────────────────┐         ┌─────────────┐
│   Host      │         │  YOUR signaling server  │         │   Guest     │
│   (Otaku)   │◀───WS──▶│  (Fly.io / Railway)     │◀───WS──▶│   (Otaku)   │
│             │         │  Rust + Axum            │         │             │
└─────┬───────┘         └─────────────────────────┘         └─────┬───────┘
      │                                                            │
      │              WebRTC P2P DataChannel                        │
      │              (DTLS-encrypted, E2E)                         │
      └──────  play/pause/seek/episode/chat/presence  ────────────┘
      │                                                            │
      │         Each client streams video independently            │
      ▼                                                            ▼
  AllAnime CDN                                              AllAnime CDN
```

### Layers

1. **Signaling (self-hosted, Rust + Axum WebSocket server):** used to exchange SDP offers/answers and ICE candidates during room creation/join, **and remains connected for the lifetime of the session** to support: ICE restarts on network changes, guest joins/leaves, explicit "host has left → room closes" broadcast, and session-level auth. This is a deliberate choice over "idle after P2P established" because it dramatically simplifies recovery paths.
2. **STUN:** Google's public STUN servers (`stun.l.google.com:19302`) handle NAT traversal for the common case. No cost, no trust boundary — STUN is request/response only and cannot see session data.
3. **TURN (self-hosted coturn):** deployed alongside the signaling server. Falls back to relaying DataChannel traffic when direct P2P is impossible (~15 % of users on symmetric NAT / CGNAT). Uses HMAC ephemeral credentials to prevent abuse.
4. **WebRTC DataChannel (Rust, via `webrtc-rs` crate):** DTLS-encrypted end-to-end transport for sync messages and chat. Runs in the Otaku binary, not the WebView, so it survives Android WebView backgrounding and platform-specific WebRTC quirks.

### Hosting decision

- **Signaling server + coturn: self-hosted by the project maintainer** on Fly.io (default) or Railway (alternative).
- **Default signaling URL is bundled** in Otaku releases; users can override in Settings → Binge → Signaling URL if they run their own deployment.
- **Rationale for self-hosting:** user preference for local-first/no-vendor-lockin. Fly.io's free tier covers projected usage with significant headroom.

## Room Lifecycle

### Create
1. Host clicks "🎬 Binge with Friends" in the VideoPlayer.
2. Otaku calls `binge_create_room(display_name)`.
3. Rust opens a WebSocket to the signaling server, sends `{type: "create"}`.
4. Signaling server generates a 6-char alphanumeric code (48 bits, collision-free for realistic concurrent-room counts), stores `{code, host_ws_id, created_at}` in memory, replies `{type: "created", code}`.
5. Host receives code; UI shows it with Copy, QR code, and deep-link buttons (`otaku://join/MANGA7`).

### Join
1. Guest enters code (or clicks deep link) → `binge_join_room(code, display_name)`.
2. Rust opens a WebSocket, sends `{type: "join", code}`.
3. Signaling server forwards `{type: "guest-joining", guest_id, display_name}` to the host.
4. Host creates a new `RTCPeerConnection` for this guest, produces an SDP offer, sends it via signaling.
5. Guest replies with SDP answer via signaling. ICE candidates trickle through the same path.
6. Once DataChannel is open, Rust emits `binge:peer-joined` to frontend.
7. Guest's VideoPlayer automatically loads the host's current episode and seeks to host's current position.

### Leave
- **Host leaves:** signaling server broadcasts `{type: "room-closed", reason: "host_left"}` to all guests. Each guest's UI shows "Host left. Keep watching solo or take over as host." Eldest remaining guest becomes host if they accept.
- **Guest leaves:** `binge:peer-left` event fires to remaining peers. Presence chip disappears.
- **Idle timeout:** signaling server deletes room after 30 minutes of no signaling traffic. Active P2P sessions continue independently.

### Reconnect
- Brief network drops: WebRTC handles automatically via ICE restart. Banner "Reconnecting..." shows for up to 10 seconds.
- Full disconnect: guest prompted "Rejoin room?" with the code pre-filled.

## Sync Protocol

### Message types (JSON over DataChannel)

```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
enum SyncMsg {
    // Clock sync: host ↔ guest ping/pong using monotonic timestamps
    Ping { id: u32, t_send_mono_ns: u64 },
    Pong { id: u32, t_send_mono_ns: u64, t_host_mono_ns: u64 },

    // Host → all: heartbeat every 2s
    State { t_host_mono_ns: u64, playing: bool, pos: f64, episode_id: String },

    // Host → all: playback transitions
    Play    { t_host_mono_ns: u64, pos: f64 },
    Pause   { t_host_mono_ns: u64, pos: f64 },
    Seek    { t_host_mono_ns: u64, pos: f64 },
    Episode { t_host_mono_ns: u64, target: SyncTarget, pos: f64 },

    // Guest reports readiness after Episode change
    Resolved    { id: PeerId, episode_id: String, duration_sec: u32 },
    Incompatible { id: PeerId, reason: String },

    // Guest → host: polite request for a transition
    Request { action: RequestAction, payload: serde_json::Value, from: PeerId },

    // Presence & flow control
    Join      { id: PeerId, name: String, color: String },
    Leave     { id: PeerId },
    Buffering { id: PeerId, stalled: bool },

    // Chat — uses wall clock only for display ordering, not sync
    Chat { from: PeerId, body: String, wall_ts_ms: u64 },
}
```

**All sync-critical timestamps use monotonic clocks, not wall clocks.** On Rust that's `Instant::now()`; on the browser side that's `performance.now()`. Wall clocks (Unix time) are only used for chat display ordering, where a few seconds of skew is cosmetic.

### Clock offset protocol

Once the DataChannel opens, guest runs a handshake to estimate the host's monotonic clock offset:

1. Guest sends `Ping { id, t_send_mono_ns: G_s }`.
2. Host replies `Pong { id, t_send_mono_ns: G_s (echoed), t_host_mono_ns: H_r }` where `H_r` is the host's monotonic time when it received the ping.
3. Guest on receive computes: `G_r = guest_mono_now()`, `rtt = G_r - G_s`, `host_offset_ns = H_r - (G_s + rtt / 2)`.
4. Guest maintains a rolling window of the 10 lowest-RTT samples; uses their median as `host_offset` (discards outliers caused by GC pauses, scheduler hiccups).
5. Pings run every 10 seconds during a session to track drift from CPU frequency scaling and sleep/wake events.

This gives a reliable estimate of "host_mono_ns at this exact moment" accurate to within a few ms under typical conditions.

### Drift correction (guest side) — revised

When guest receives a `State { t_host_mono_ns, playing, pos, ... }`:

1. Compute `expected_pos = pos + (guest_estimated_host_mono_now_ns - t_host_mono_ns) / 1e9` (only if `playing`).
2. `drift = video.currentTime - expected_pos`.
3. Apply the same three-tier correction as before (hard seek / playbackRate nudge / ignore), but with the threshold based on `drift` using the correctly-estimated offset.

Because the offset estimate is monotonic-based, it survives wall-clock adjustments (NTP skew, DST, manual clock changes) that would otherwise break naive timestamp-based sync.

### Drift correction (guest side)

Every 2 seconds the host broadcasts a `State` message. On receipt the guest:

1. Computes `expected_pos = msg.pos + (now_ms - msg.ts - one_way_trip_ms) / 1000` (only if `msg.playing`).
2. Computes `drift = video.currentTime - expected_pos`.
3. If `|drift| > 1.0 s` → hard seek to `expected_pos`. This is visible but rare.
4. If `0.3 s < |drift| ≤ 1.0 s` → set `video.playbackRate` to `0.95` (catch up) or `1.05` (slow down) until drift is under 0.1 s, then restore `1.0`. Imperceptible.
5. If `|drift| ≤ 0.3 s` → do nothing.

This pattern is well-established (Teleparty, Netflix Party, Twitch Hyperping). The 1.0 s hard-seek threshold prevents visual glitches for small drifts; the `playbackRate` nudge handles everything else invisibly.

### Ready gate

When host starts playback on a fresh or paused video, guests may still be buffering:

1. Host broadcasts `Play`.
2. Each guest reports `Buffering { stalled: true }` until HLS reports `buffered.end ≥ video.currentTime + 4`.
3. Host's UI waits for every present guest to reach `stalled: false`, or 3 seconds max.
4. Host's own playback starts; broadcasts `State` immediately so any straggler catches up via drift correction.

This prevents the "host is 30 seconds ahead because one guest was buffering" scenario common in naive implementations.

### Episode change and media identity

The naive "guest loads the same episode ID" is insufficient because guests may have a different extension, a different source priority, or no access to the same variant (sub/dub, cut vs uncut). To prevent silent desync where two clients play different content, the protocol carries a **canonical sync target** on every episode transition.

```rust
struct SyncTarget {
    anime_id: String,         // canonical anime identifier (Otaku-internal)
    mal_id: Option<u32>,      // MyAnimeList ID when available (cross-source anchor)
    episode_number: f64,      // 1.0, 2.5, etc. — supports fractional specials
    episode_id: String,       // host's extension-specific episode ID (hint, not authoritative)
    extension_id: String,     // host's extension (hint)
    variant: Variant,         // Sub | Dub | Raw
    expected_duration_sec: Option<u32>,  // sanity-check value from host's player
}

enum Variant { Sub, Dub, Raw }
```

### Episode change flow

1. Host clicks a new episode in EpisodeList.
2. Rust broadcasts `Episode { target: SyncTarget, pos: 0 }`.
3. Each guest resolves the target to a playable stream:
   - **Preferred:** match on `(extension_id, episode_id)` if the guest has the same extension.
   - **Fallback 1:** match on `(mal_id, episode_number, variant)` across any extension.
   - **Fallback 2:** match on `(anime_id, episode_number, variant)` without variant if a variant match fails.
   - **Fallback 3:** no match → guest reports `Incompatible { reason: "episode_unavailable" }` and enters chat-only mode for this session segment. UI shows "Host is watching an episode you don't have access to. You can still chat."
4. When a guest resolves the target, it calls the existing `getVideoSources` and loads HLS.
5. Host waits for each peer to report `Resolved` or `Incompatible`, then applies the ready gate (below) for Resolved peers.
6. If `expected_duration_sec` differs from the guest's resolved stream duration by >5 %, the guest logs a warning and surfaces an amber badge ("may be a different cut") but continues — the mismatch is informational, not blocking.

### Guest soft-requests

Guests see play/pause/seek controls in their UI, but pressing them sends `Request` to the host instead of applying locally. Host sees a toast: *"Yuki wants to pause"* with Accept / Dismiss buttons. Default: auto-accept after 500 ms (host can disable in Settings → Binge → Auto-accept requests). Prevents griefing while keeping guests feeling agency.

### "Mute sync" escape hatch

A guest toggle lets them desync temporarily (to rewatch a scene without disturbing the group). When enabled, the guest ignores incoming sync messages and their controls act locally. A badge shows "Out of sync" until toggled off, at which point drift correction immediately re-aligns them.

### Chat

Chat messages are broadcast on the same DataChannel, multiplexed by `t: "chat"`. In V1, messages exist only in memory and are cleared when the room closes. No server persistence. Maximum message length: 500 characters. Spam guard: frontend disables input for 1 second after send.

## UI/UX

### Entry points

1. **From the player** — a new button next to PiP/MiniPlayer toggle: "🎬 Binge with Friends". Opens the create-room modal prefilled with the current anime/episode.
2. **From top nav** — a "Binge" icon visible app-wide. Click → modal with "Start a Room" and "Join a Room" tabs.
3. **Deep link** — `otaku://join/MANGA7` registered via `tauri://` URL scheme. Opens Otaku and prompts confirmation before joining.

### Create-room modal

```
┌────────────────────────────────────┐
│  Your room is ready                │
│                                    │
│     ┌──────────┐                  │
│     │  MANGA7  │   [Copy code]    │
│     └──────────┘                  │
│                                    │
│  [QR code]      [Copy link]        │
│                                    │
│  Display name: [Vishnu         ]   │
│                                    │
│  ⚙  Auto-accept guest requests    │
│  ⚙  Strict sync                   │
│                                    │
│           [Start Room]             │
└────────────────────────────────────┘
```

### Join-room modal

```
┌────────────────────────────────────┐
│  Join a binge room                 │
│                                    │
│  Code:   [_][_][_][_][_][_]        │
│                                    │
│  Display name: [Yuki           ]   │
│                                    │
│  ⚙  Sync strictly with host       │
│                                    │
│             [Join]                 │
└────────────────────────────────────┘
```

### In-session layout

The existing `EpisodeList` sidebar is replaced by a combined `BingeSidebar` when the user is in a room:

```
┌─────────────────────────────────────────┬──────────────────┐
│                                         │  Binge · MANGA7  │
│                                         │  ─────────────── │
│                                         │  👥 3 watching   │
│              VIDEO PLAYER               │  👑 Vishnu       │
│                                         │  ● Yuki          │
│                                         │  ⏳ Kai (buf.)   │
│                                         │  ─────────────── │
│                                         │  💬 Chat         │
│                                         │  Yuki: lol       │
│                                         │  Vishnu: wait    │
│                                         │                  │
│                                         │  [type message]  │
├─────────────────────────────────────────┤  ─────────────── │
│  ▶  ⏩ 1:23 / 24:00  [progress bar]     │  [Leave Room]    │
└─────────────────────────────────────────┴──────────────────┘
```

Details:

- **Presence chips** show avatar color, name, host crown, and per-peer status (watching / buffering / out-of-sync / disconnected).
- **Ping dot** — small green/yellow/red indicator next to each peer, showing round-trip latency health.
- **Self-buffering indicator** — when the local player is holding up the room, the video dims slightly and a subtle loader appears. Encourages users to upgrade their connection or lower quality.
- **Chat input** — standard `<input>` with 500-char limit and emoji support. Disabled for 1 s after send.
- **Leave Room button** — always visible at bottom of sidebar. Confirmation dialog if the user is host (to prevent accidentally ending the room for everyone).

### Error states

| Scenario | UX |
|---|---|
| Signaling server unreachable | Modal: "Can't reach the room server. Check your internet or signaling URL." with `Retry` button. |
| Room code invalid or expired | Input field shows inline error. |
| P2P fails (TURN also fails) | Modal: "Couldn't connect to host's network. Ask them to check their firewall, or try Tailscale." |
| Host disconnects | Toast + sidebar banner: "Host left. Keep watching solo, or take over as host." |
| Guest's stream errors | Local player shows error; sync state preserved; auto-reconnects on recovery. |
| Network drops briefly | Banner: "Reconnecting..." with auto-retry (ICE restart). Playback continues locally. |
| Drift >10 s (user paused without mute-sync, then came back) | Prompt: "You're 12 s behind — Catch up / Stay out of sync". |

### Settings (new "Binge" tab in `/settings`)

- **Display name** — defaults to OS username; user-editable.
- **Avatar color** — auto-hashed from display name; "Randomize" button.
- **Signaling server URL** — default = bundled URL, user can override for self-hosted deployments.
- **Auto-accept guest requests** — toggle; on by default.
- **Strict sync mode** — always apply drift correction (default) / Relaxed (allow >3 s drift without correcting).
- **Allow deep links** — toggle; on by default. Off disables `otaku://join/*` URL scheme handling.

## Backend (Rust)

### New module layout

```
src-tauri/src/
├── binge/
│   ├── mod.rs              ← public API, BingeState struct, init
│   ├── signaling.rs        ← WebSocket client (tokio-tungstenite)
│   ├── peer.rs             ← webrtc-rs RTCPeerConnection wrapper
│   ├── room.rs             ← room state machine (host vs guest)
│   ├── sync.rs             ← drift correction & ready-gate logic
│   ├── messages.rs         ← serde types for DataChannel msgs
│   └── commands.rs         ← Tauri command handlers
```

### Cargo.toml additions

```toml
webrtc = "0.12"                  # WebRTC.rs (pure Rust)
tokio-tungstenite = "0.26"       # signaling WebSocket client
futures-util = "0.3"             # streams & sinks for WS
# serde, tokio, axum already present
```

Binary size impact: +3–5 MB per platform. Acceptable given Tauri's already-compact footprint.

### BingeState

```rust
pub struct BingeState {
    signaling: Mutex<Option<SignalingClient>>,
    room: Mutex<Option<Room>>,
    event_sink: UnboundedSender<BingeEvent>,
    settings: Arc<SettingsClient>,
}
```

Held as a Tauri-managed state. Frontend interacts via commands; events flow back through Tauri's event system.

### Tauri commands

```rust
// All return Result<T, String> for clean frontend error handling.

#[tauri::command]
async fn binge_create_room(
    state: State<'_, BingeState>,
    display_name: String,
) -> Result<RoomInfo, String>;

#[tauri::command]
async fn binge_join_room(
    state: State<'_, BingeState>,
    code: String,
    display_name: String,
) -> Result<RoomInfo, String>;

#[tauri::command]
async fn binge_leave_room(state: State<'_, BingeState>) -> Result<(), String>;

#[tauri::command]
async fn binge_send_chat(state: State<'_, BingeState>, text: String) -> Result<(), String>;

#[tauri::command]
async fn binge_broadcast_playback(
    state: State<'_, BingeState>,
    event: PlaybackEvent,
) -> Result<(), String>;  // host only

#[tauri::command]
async fn binge_request_playback(
    state: State<'_, BingeState>,
    event: PlaybackEvent,
) -> Result<(), String>;  // guest → host

#[tauri::command]
async fn binge_get_status(state: State<'_, BingeState>) -> Result<BingeStatus, String>;

#[tauri::command]
async fn binge_accept_request(
    state: State<'_, BingeState>,
    request_id: String,
) -> Result<(), String>;  // host only
```

### Events emitted to frontend

```
binge:peer-joined       { id, name, color, is_host }
binge:peer-left         { id, reason }
binge:peer-buffering    { id, stalled }
binge:chat              { from, body, ts }
binge:sync              { event, ts }       // apply to player
binge:request           { id, from, action, payload }  // host receives guest requests
binge:room-closed       { reason }
binge:connection        { status }          // Connecting|Connected|Reconnecting|Failed
binge:error             { code, message }
```

## Frontend (React + TypeScript)

### New modules

```
src/
├── store/
│   └── bingeStore.ts          ← Zustand: room state, peers, chat buffer, connection
├── hooks/
│   ├── useBingeSync.ts        ← hooks into VideoPlayer events
│   └── useBingeEvents.ts      ← subscribes to Tauri events
└── components/binge/
    ├── BingeButton.tsx        ← player button
    ├── CreateRoomModal.tsx
    ├── JoinRoomModal.tsx
    ├── BingeSidebar.tsx       ← in-session presence + chat
    ├── PeerChip.tsx
    ├── ChatLog.tsx
    ├── ChatInput.tsx
    ├── HostRequestToast.tsx   ← host sees guest-soft-requests here
    └── index.ts
```

### Zustand store shape

```typescript
interface BingeStore {
  // Connection state
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  room: { code: string; is_host: boolean } | null;

  // Peers
  peers: Record<PeerId, Peer>;   // Peer = { id, name, color, status, is_host }

  // Chat (session-only, in-memory)
  messages: ChatMessage[];

  // Host-side: pending requests
  pendingRequests: Request[];

  // Actions
  createRoom(displayName: string): Promise<void>;
  joinRoom(code: string, displayName: string): Promise<void>;
  leaveRoom(): Promise<void>;
  sendChat(text: string): void;
  acceptRequest(id: string): void;
  dismissRequest(id: string): void;
}
```

### Integration with `VideoPlayer.tsx`

Minimal touch:

```typescript
const { isInRoom, isHost, broadcastPlayback } = useBingeSync();

// Existing play/pause/seek/episode handlers:
const onPlay = () => {
  /* existing code */
  if (isInRoom && isHost) broadcastPlayback({ type: 'play', pos: video.currentTime });
  if (isInRoom && !isHost) requestPlayback({ type: 'play', pos: video.currentTime });
};

// New effect: apply incoming sync events
useBingeEvents('binge:sync', ({ event, ts }) => {
  if (isHost) return;  // host ignores its own broadcasts
  applySyncEvent(videoRef.current, event, ts);
});
```

The VideoPlayer stays fully functional outside of rooms — Binge is purely additive.

### Database

One addition to existing `app_settings` table (no new migration — table handles arbitrary keys):

- `binge_display_name: string`
- `binge_signaling_url: string` (default = bundled)
- `binge_auto_accept_requests: bool` (default `true`)
- `binge_strict_sync: bool` (default `true`)
- `binge_allow_deep_links: bool` (default `true`)

## Signaling Server

Shipped as a separate Rust project in a new repo directory:

```
binge-signal/
├── Cargo.toml
├── Dockerfile
├── fly.toml                  ← one-command Fly.io deploy
├── docker-compose.yml        ← local dev + coturn bundling
├── coturn.conf
├── src/
│   ├── main.rs               ← axum + tokio WebSocket server
│   ├── room.rs               ← in-memory room map, code generation
│   └── messages.rs           ← signaling message types
└── README.md                 ← deploy guide for Fly.io and Railway
```

### Signaling message types

```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
enum SignalingMsg {
    Create,
    Created { code: String },
    Join { code: String, display_name: String },
    Joined { code: String, peer_id: String },
    GuestJoining { guest_id: String, display_name: String },
    Offer { target: String, sdp: String },
    Answer { target: String, sdp: String },
    IceCandidate { target: String, candidate: String },
    Leave,
    RoomClosed { reason: String },
    Error { code: String, message: String },
}
```

### Server responsibilities

- Generate unique 6-char codes (reject with `Error` on collision; retry client-side).
- Track `{code → {host_ws, [guest_ws]}}` in an `Arc<Mutex<HashMap>>`.
- Forward SDP offers/answers and ICE candidates between correct peers.
- Delete rooms 30 minutes after last signaling activity.
- Emit periodic WebSocket pings to detect dead clients.
- Rate-limit: 5 room creations per IP per hour; 10 joins per IP per minute.
- Log requests with user names redacted.

### Deploy targets

- **Fly.io (default):** `fly launch && fly deploy`. Free tier covers projected usage.
- **Railway (alt):** click "Deploy" button from README; sets up via railway.json.
- **Docker Compose (local dev):** `docker compose up` runs both the signaling server and coturn side-by-side.

### coturn configuration

```
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=<env var, 256-bit random>
realm=otaku.binge
total-quota=100
bps-capacity=0
stale-nonce=600
no-stdout-log
simple-log
no-loopback-peers
no-multicast-peers
```

HMAC ephemeral credentials are minted by the signaling server (same `static-auth-secret`) and issued to clients with a 1-hour TTL.

## Security & Privacy

| Concern | Mitigation |
|---|---|
| Guessable room codes | 6-char alphanumeric = ~2 billion permutations. Signaling server cleans up rooms after 30 min idle; enumeration is pointless. |
| Traffic interception | WebRTC DataChannel is DTLS-encrypted end-to-end. Signaling server never sees session content after SDP exchange (only ICE candidates, which are public by nature). |
| Persistent user tracking | No accounts. Display names are per-session, user-editable, and can be pseudonyms. Peer IDs are generated per room, not reused. |
| Signaling server log analysis | Server logs are request-only; user names redacted. Nothing persisted to disk. |
| TURN free-rider abuse | HMAC ephemeral credentials with 1-hour TTL. Only users who authenticated through signaling get credentials. |
| Spam / flooding | Rate limiting (5 rooms/IP/hr, 10 joins/IP/min). Chat input throttled to 1 s/message. |
| Drive-by deep links | `otaku://join/CODE` shows confirmation dialog before connecting. User must click Accept. Setting toggle to disable URL scheme. |
| Malicious guest trying to take over | Only host broadcasts playback; guest requests require explicit (or auto-) acceptance. Host crown clearly displayed. |
| Malicious host desyncing guests | Guests can toggle "Mute sync" and watch at their own pace, or leave the room. |

### Privacy non-transmissions

The following are **never** sent to the signaling server, TURN server, or other peers:

- Watch history, library contents, stats
- Otaku settings (except `display_name` + `binge_*` settings when explicitly shared)
- IP addresses to other peers (relayed via TURN when needed)

## Testing Strategy

### Unit tests (Rust)

- **`room.rs`:** state transitions (idle → host → guests added → host transfer → closed). Collision in code generation. Idle timeout.
- **`sync.rs`:** drift calculation given (host_ts, host_pos, now, guest_pos). Playback-rate selection (0.95 / 1.0 / 1.05). Ready-gate logic with N peers.
- **`messages.rs`:** serde roundtrip for every message variant.

### Integration tests (Rust)

- Spin up 2 webrtc-rs peer connections in-process, exchange SDP via mock signaling, verify DataChannel opens, messages arrive in order, TURN fallback engages when direct path disabled.
- Chaos cases: drop messages, reorder, duplicate, malformed JSON. Confirm sync recovers within 2 heartbeats.

### E2E (manual checklist)

- Run 2 Otaku instances on same machine with different `--user-data-dir` flags.
- Host creates room, copies code. Guest joins.
- Verify: play, pause, seek, episode change all sync.
- Verify chat: messages appear in both sidebars within 300 ms.
- Verify ready-gate: throttle guest's network briefly, confirm host waits.
- Verify host disconnect: close host app, confirm guest sees "Host left".
- Verify re-join: re-open code, verify state recovers.

### Cross-platform smoke

- Host on Mac, guest on Windows via LAN → should P2P directly.
- Host on Mac, guest on Android (cellular) → should engage TURN for at least one media pair.
- Host on Linux, guest on Mac via Tailscale → direct P2P without coturn.

### Performance budget

- **Sync message RTT:** p50 < 100 ms LAN, < 300 ms regional, < 600 ms TURN-relayed.
- **Drift under normal conditions:** p95 < 500 ms.
- **Chat RTT:** p50 < 150 ms, p95 < 400 ms.
- **Memory overhead when in room:** < 15 MB extra per Otaku instance.
- **CPU overhead when in room (host, 3 guests):** < 2 % on a modern laptop.

## Release Plan

### Alpha (internal, week 1)
- Merge behind Settings → Labs → "Enable Binge Watch (Alpha)" toggle.
- No menu items or player buttons visible by default.
- Maintainer + 2–3 friends test for a week on real networks.

### Beta (opt-in, week 2)
- Toggle renamed "Enable Binge Watch (Beta)".
- Player button and top-nav icon surface only when toggle is on.
- Gather feedback via existing feedback table (migration `023_feedback_table.sql`).
- Iterate on reconnect edge cases, error messaging, and UI polish.

### GA (next minor release, v1.2)
- Toggle flipped on by default.
- Menu and UI visible to all users.
- Headline entry in release notes and README.
- Documentation page with FAQ and troubleshooting.

## Open Questions (to resolve during implementation planning)

- Display name conflict: two guests named "Yuki" — disambiguate by appending `#2` or by color only? (Leaning: color only; avatar color is already hashed from name + peer id, so collisions are rare.)
- How aggressive is auto-reconnect after a 60-second network outage? → Default proposal: retry 3× with exponential backoff on signaling, let WebRTC ICE restart handle the P2P side, prompt user if neither recovers within 30 s.
- Coturn capacity planning: free Fly.io tier limits concurrent TURN sessions. If we hit them, do we degrade gracefully (show "server busy, try later") or queue?

## Effort Estimate

- **Signaling server + coturn (Rust, deployment):** 1.5 days
- **Rust `binge/` module (`webrtc-rs`, signaling client, sync engine):** 3 days
- **Frontend (store, modals, sidebar, integration):** 2 days
- **Testing (unit, integration, manual E2E, cross-platform):** 1.5 days

**Total:** ~6–8 days for V1 as specified.

## Future Work (V2+)

- Voice chat via WebRTC audio tracks (adds media-plane coturn usage, echo cancellation, push-to-talk).
- Emoji reactions overlay anchored to video timestamps.
- Saved "clubs" — recurring groups that get auto-invited when one creates a room.
- Manga co-reading: same architecture, page-turn sync instead of video-position sync.
- Mobile push notifications for incoming invites via Tauri notifications.
- Scrub-together timeline (scrubbing the progress bar seeks for everyone).
- Recording / timeline-aware screenshots shared with the room.
