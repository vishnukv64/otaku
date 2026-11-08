# Pair & sync: Otaku phone ↔ Otaku Mac over the Praxis relay

Status: **design, awaiting approval** (Phase 6 of the mobile UI build). Mock: `.praxis/design/01a1b642-4348-7d3e-9cf2-fde051ed2e46/files/pair.html`.

## Goal

Pair the Otaku phone app with Otaku on the user's Mac by scanning a QR code, then keep watch progress, library and reading progress in sync both ways, share usage stats, hand an episode/chapter off between devices, and let the phone act as a remote for the Mac player.

## What we reuse from the Praxis relay (`praxis-harness/collab`, `deploy/relay`)

| Piece | Praxis | Otaku reuse |
|---|---|---|
| Link | `collab/link.go`: room id + 32-byte AES-256 room key + 16-byte write token; `host/r/<room>.<secret>` | Same format inside the QR (`otaku://pair?l=<FullLink>`), so the relay sees a normal room |
| Transport | WebSocket `wss://<relay>/r/<room>?role=host|guest`, admission ack, reconnect with backoff (`collab/relay.go`) | Mac dials as **host**, phone as **guest**; same admission and reconnect rules |
| Encryption | `collab/crypto.go` AES-256-GCM, 12-byte nonce; wire = JSON `{Nonce, Body}` (Go `[]byte` → base64) | Same sealing, in Rust with the `aes-gcm` + `base64` crates Otaku already depends on |
| Frames | `collab/frame.go` `{kind, data, seq, dev}`; `seq` is a strictly increasing µs counter sealed with the frame (replay guard) | Same envelope, Otaku frame kinds (below) |
| Verification | Praxis phone pairing: both screens show the same words derived from the key before approval | 4 words from `SHA-256(roomKey)`, compared on both screens; the 6-digit code is the typed form of the same link (short-lived lookup on the Mac) |
| Auth | Hosted relay needs a relay token (`Authorization: Bearer`), issued after Google sign-in, **`@facets.cloud` accounts only**, 7-day HMAC; `prx relay login` stores it | See "Relay access" — this is the open decision |

The relay stays **content-blind**: it only routes ciphertext by room id. No relay change is needed for the protocol itself.

## Relay access (decision needed)

The hosted Praxis relay (`wss://relay.internal-tools.console.facets.cloud`) only admits `@facets.cloud` Google accounts. Options:

1. **Hosted Praxis relay, your account (recommended for now).** The Mac reads the relay token that `prx relay login` already stores (`praxis-relay` credential) or runs its own PKCE sign-in (`/login` + `/login/exchange`). The phone gets a guest token the same way the Praxis phone does (`/phone-room` ticket). Works today for you; not for public Otaku users.
2. **Self-hosted open relay.** Run `praxis-harness/cmd/relay` (anonymous, no sign-in) somewhere Otaku can reach. Works for anyone, adds a service to run.
3. **LAN only.** No relay: the Mac exposes the same sealed protocol on its local video server; works only on the same Wi-Fi.

Plan: implement the protocol once with a pluggable relay URL + optional token; ship (1) + (3) (LAN direct when both are on the same Wi-Fi, relay otherwise), keep (2) a config switch.

## Otaku frame kinds

| Kind | Direction | Data |
|---|---|---|
| `hello` | both | device id, name, platform, app version, schema version, capabilities |
| `sync-pull` | both | `since` cursor per table |
| `sync-push` | both | batch of change records (below) |
| `sync-ack` | both | highest applied `hlc` per table |
| `stats` | both | daily watch/read seconds per device (for combined Stats) |
| `presence` | both | now playing (media, episode, position) for handoff cards |
| `handoff` | both | "continue here": media, episode/chapter, position |
| `remote` | phone→Mac | play, pause, seek ±s/abs, next, prev, volume |
| `ping` / `bye` | both | liveness, unpair |

## Sync model

- **Records:** `watch_history` (media, episode, position, completed, last_watched), `reading_history` (manga, chapter, page, completed), `library` (status, favorite, score, tags), `library_tags`, `media` (cached metadata only as needed).
- **Change log:** a new table `sync_changes(table, key, payload_json, hlc, device_id, deleted)` written by triggers (or by the Rust commands that already write those tables). `hlc` = hybrid logical clock (`unix_ms << 16 | counter`), so ordering survives clock skew.
- **Merge:** per record, **highest `hlc` wins**; ties break on device id. Overwritten values go to `sync_conflicts` (kept 30 days) and the app shows a summary ("3 changes from MacBook replaced older ones").
- **Watch progress special case:** `completed=true` never reverts to false by an older write; position takes the newer `hlc`.
- **Offline queue:** changes stay in `sync_changes` until acked; the status chip shows "N changes waiting".
- **First sync:** both sides send everything since 0; the conflict summary is shown once.

## Pairing flow (matches the mock)

1. Mac: Settings › Devices › Pair a phone → generates a link (`GenerateLink(relay, write=true)` equivalent), shows QR + 6-digit code (2 min, single use), dials the relay as host.
2. Phone: You › Pair with Mac → camera (or type the code) → dials as guest → both show 4 words → user approves on the Mac.
3. Phone names itself; both store `{device_id, name, room_id, room_key, write_token, relay_url, paired_at}` in a new `paired_devices` table (room key in the OS keychain where available).
4. Unpair on either side deletes the key and sends `bye`; the other side drops the room.

## Native work

- **Mac (Rust, `src-tauri`):** `sync/` module: link + sealing + WebSocket client (add `tokio-tungstenite`), change log + merge, LAN listener on the existing video server port, Tauri commands/events for the UI.
- **Phone:** same Rust module (it compiles for iOS); camera QR scan via a small Tauri plugin or the WebView `getUserMedia` + a JS QR decoder (decide in implementation; WebView path avoids native plugin work).
- **UI:** the screens in `pair.html` (You row, Settings › Devices, scan/verify/name/connecting/ready, device list/detail, sync status chip, conflict summary, combined Stats, handoff card, remote, send-to-Mac, error states).

## Risks

- Relay access is limited to `@facets.cloud` accounts on the hosted relay (see above).
- iOS camera permission + background WebSocket limits: sync runs while the app is foregrounded; on resume it pulls.
- Schema drift: `hello` carries a schema version; a too-old peer gets the "Update Otaku on your Mac" state.

## Estimate

Protocol + sync core 2 days, pairing UI + QR 1 day, stats/handoff/remote 1 day, tests (merge rules, HLC, sealing round-trip against Go test vectors) included.
