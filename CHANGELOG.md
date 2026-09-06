# Changelog

All notable changes to Abyss (the custom plugins, settings, and build tweaks
layered on top of the Equicord/Vencord base) are documented here.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/), and
versioning follows [Semantic Versioning](https://semver.org/) — see
`version.json` for the current version.

## [Unreleased]

### Added
- Repo workspace reorg: `git init` safety net, this `CHANGELOG.md`,
  `version.json`, and a real `CLAUDE.md` (replacing the broken 6-byte stub).
- `ImageToolkit` plugin: click an avatar/banner to enlarge it, right-click for
  reverse-image search (Google Lens/Images, Yandex, Bing, TinEye, SauceNAO,
  IQDB) or to copy/save it — replaces the three separate, less reliable stock
  plugins `ViewIcons`, `ReverseImageSearch`, and `FastPFP`.
- `InterfaceLanguage` plugin + Settings > Abyss language picker: auto-translates
  Abyss's own Settings UI descriptions (Plugins, Themes, Changelog, Cloud,
  Backup & Restore, Patch Helper) between English/Français without touching
  plugin titles or logic.
- `WordBombHelper` plugin: a standalone draggable window for WordBomb-style
  Discord Activities — tracks unused letters, auto-picks the best word for
  the given letters, and types it at a configurable speed/typo rate.
- `MuteAllServers` plugin, ported from Nightcord: right-click a server for a
  searchable checklist to mute several servers at once (permanently,
  including @everyone/role mentions) and mark them as read.
- `uncapFrameRate` setting (Settings > Abyss), split out of `maxPerformance`:
  isolates the `disable-gpu-vsync` Chromium flag as an explicit opt-in,
  since it was the cause of video/GIF playback stutter (see Fixed).
- `injector/` — a separate Tauri v2 (Rust + Svelte 5) sub-project: a
  standalone "Abyss Injector" app that detects Discord installs and
  patches/unpatches them, with its own auto-updater and a build-update
  channel that downloads the latest `patcher.js` etc. from this repo's
  `builds` branch, so it can be shared with people who have neither this
  repo nor Node installed. See `injector/README.md`.
- `SmoothType` plugin, ported from Nightcord: replaces the chat input's
  blinking caret with a synthetic one that glides smoothly between
  positions (configurable duration, easing curve, color).
- `GameActivityButton` plugin: DOM-based replacement for the stock
  `GameActivityToggle` (see Fixed) — same toggle, placed to the left of the
  mic button, white when active and red-with-strikethrough when off
  (matches the mic-muted color).

### Fixed
- `NewPluginsManager` was disabled in settings — re-enabled; it's what shows
  the "New Plugins and Settings" popup on connect when plugins are added.
- `TokenImporter`'s "Comptes locaux" tab: the "Ouvrir" button used
  `window.open("discord://")`, which doesn't reliably shell out to the OS
  protocol handler from an Electron renderer, and would target the default
  install rather than whichever one is actually present (e.g. installs
  under `C:\ProgramData\<user>\` instead of `%LOCALAPPDATA%`). Now launches
  the real executable directly via its own `Update.exe --processStart`.
- Stock `GameActivityToggle` stopped adding its button (next to mic/deafen):
  its `UserAreaAPI` dependency patches Discord's internal render code via
  an anchor string (`.DISPLAY_NAME_STYLES_COACHMARK)`) that used to sit next
  to the account panel's render logic — a Discord bundle restructure moved
  it into an unrelated "coachmark" enum module, so the patch's `find`
  matches but the actual code replacement silently fails. Rather than
  chase a new anchor in Discord's minified JS (guaranteed to rot again),
  replaced with `GameActivityButton` (DOM-based, see Added).
- The "Abyss has been updated! Restart" banner looping forever on every
  restart: local builds embedded a placeholder git hash/remote
  (`EQUICORD_HASH=0000...`, `EQUICORD_REMOTE=Equicord/Equicord`) that
  compared this fork against the real upstream Equicord repo's releases,
  which of course never match — so the updater always believed itself
  outdated, auto-applied a broken "update", and re-prompted every launch.
  Builds now use `--disable-updater` and let `~git-hash`/`~git-remote`
  resolve from the real local `.git` instead.
- The "Show Abyss" plugin-list filter was mislabeled onto
  `SearchStatus.EQUICORD` (a leftover from the Equicord→Abyss rename)
  instead of `SearchStatus.USER_PLUGINS`, so it showed Equicord's stock
  plugins instead of ours.
- Video/GIF playback stutter (~2fps) caused by `maxPerformance`'s
  `disable-gpu-vsync` flag decoupling frame presentation from the display's
  refresh rate — isolated into the new opt-in `uncapFrameRate` setting
  (off by default) so `maxPerformance`'s other flags stay safe to leave on.
- `AntiMoveDeco`'s header-bar icon didn't match the size of other header
  icons, and silently did nothing when clicked outside a voice channel
  instead of telling the user why.
- `TokenImporter`'s modal and `MultiInstance`'s native/icon handling
  redesigned/hardened.

### Removed
- `SkinwalkerProfile` plugin, at the user's request.
- `FastPFP` plugin, superseded by `ImageToolkit`.
- Leftover GhostAccount runtime artifacts from before it was removed from
  Abyss: `abyss-ghost-config.json` and `abyss-ghost-preloads/` in the
  Discord/Canary data folders, plus the orphaned `GhostAccount` and
  `SkinwalkerProfile` entries in `settings.json`.

## [1.0.0] — 2026-09-05

### Added
- `DMProof` plugin: blurs avatars/names in the private messages list (hover
  to reveal), redacts sender/preview in desktop notifications, and hides the
  DM sender's avatar from the Windows taskbar overlay icon.
- `LeaveAllServers` plugin, ported from Nightcord.
- `reduceBackgroundActivity` setting (Settings > Abyss): lets Discord idle
  down normally when minimized instead of running at full speed in the
  background.
- Enabled `NoRPC` (disables Discord's local RPC server) and `BetterGifLoad`
  (lower GIF quality) to reduce baseline RAM/CPU usage.
- ~40 custom plugins ported/built into `src/userplugins/` this cycle
  (FollowUser fake-mute/fake-deafen, ClearFriends, TokenImporter, FakeDM,
  StreamProof, MicroStudio, and others).

### Fixed
- `FollowUser`'s Fake Deafen didn't actually mute output audio — it called
  `MediaEngineStore.setOutputVolume()` directly instead of
  `MediaEngineStore.getMediaEngine().setOutputVolume()` (the mutator lives on
  the engine, not the store).
- `ClearFriends` and `LeaveAllServers` now use Discord's official REST
  endpoints (`DELETE /users/@me/relationships/:id`,
  `DELETE /users/@me/guilds/:id`) instead of fragile webpack-action lookups.
- A top-level `const { useState } = React;` destructure in `LeaveAllServers`
  crashed the entire plugin bootstrap on startup (`React` is populated
  asynchronously by Vencord's webpack finder, so it's `undefined` at module
  load time) — this silently broke *every* Abyss plugin, not just that one.

### Removed
- `SharePerms` plugin (delegated guild moderation permissions via DM
  commands) — removed at the user's request.
- The standalone `GhostAccount` plugin/browser-window feature — removed from
  Abyss entirely; rebuilt as a separate app outside this repo.
