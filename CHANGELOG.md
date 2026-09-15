# Changelog

All notable changes to Abyss (the custom plugins, settings, and build tweaks
layered on top of the Equicord/Vencord base) are documented here.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/), and
versioning follows [Semantic Versioning](https://semver.org/) — see
`version.json` for the current version.

## [Unreleased]

### Added
- `TokenImporter`: folder organization for saved accounts — right-click a
  folder to rename or delete it, drag an account onto any folder (or onto
  "Non classés") to move it there. Deleting a folder keeps its accounts,
  moving them back to unclassified rather than losing them.
- `VoiceChannelSearch`: a second search bar, "Search a user...", right below
  the existing channel/server one — finds anyone currently in a voice
  channel on any server you share with them (searched by username/display
  name), with a direct Join button. Only searches people actually in voice
  right now, not the client's entire known-user cache.
- `VoiceTools` plugin: right-click a voice/stage channel for three red
  moderation actions — mute all, deafen all, disconnect all — real
  server-side actions (not a local mute), so each is labeled "(Permissions
  required)". Always skips the user performing the action, even if they're
  in the channel themselves.
- `injector/` — full visual and functional redesign (v0.2.0): a black-hole
  video background, a splash screen with a rotating tagline, a borderless
  window with a custom macOS-style titlebar, and a fixed 3-row layout
  (Discord/Canary/PTB) that replaces the old flat install-card list. Each
  install now shows a live step-by-step progress narration during
  patch/unpatch (cleaning up a foreign mod, environment checks, install,
  restart) instead of a single spinner, and auto-detects/repairs installs
  already patched by another Vencord-family mod (Vencord, Equicord...)
  before patching with Abyss — no more needing that other mod's own
  uninstaller first. Added a Settings screen: plugin-preset import/export
  (reads/writes only the `plugins` key of Abyss's own `settings.json`, via
  a native file picker), a "Fixer Abyss" repair action that detects and
  re-downloads corrupted/incomplete injected build files, and a manual
  "check for injector update" button. The injector's own self-update
  (`tauri-plugin-updater`) is now backed by a real signing keypair and a
  dedicated `release-injector.yml` GitHub Actions workflow that builds,
  signs, and publishes a GitHub Release on every `injector-vX.Y.Z` tag —
  previously a placeholder key meant this silently never worked.
- `Cleaner` plugin: a single orchestrated panel to reset an account close to
  its original state — profile (avatar reset to Discord's own default,
  banner and profile color cleared, bio/pronouns/display name reset), clean
  own messages across every DM/group, close all DMs, leave all groups,
  leave servers, and remove friends, each independently toggleable with
  keep-lists for servers/friends. Runs everything in a fixed order
  (messages before closing/leaving, so nothing gets cleaned out of reach),
  with an 800ms delay and automatic 429-retry-with-backoff on every action
  category, and a shared progress bar/status line. Does not touch or
  replace `LeaveAllServers`/`ClearFriends`/`MessageCleaner` — fully
  self-contained, duplicating only what it needs. Its dark flat-card look
  (see Changed) is now the reference style for new Abyss plugin UIs.
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

### Changed
- Unified UI theme: `Cleaner`'s flat dark look (solid `#313338`/`#2b2d31`
  panels instead of Discord's own theme variables, indigo/red flat buttons,
  dark search/input fields, Discord's own `ScrollerThin` instead of raw
  `overflow-y` to avoid Chromium's default OS scrollbar) applied to
  `TokenImporter`, `VoiceChannelSearch`, and `MessageLoggerEnhanced`'s log
  modal — same visual language across every custom Abyss modal, function
  unchanged.
- Injector UI simplified further: removed the "Dossier du repo Abyss" field
  (nobody but a developer testing a local build needs it — the app always
  auto-downloads the public build otherwise) and the manual
  "Vérifier les mises à jour" button/version line (the silent background
  updater already covers this on its own).
- `FollowUser`'s Fake Mute/Fake Deafen: switched from trying to cut real
  local audio (via `navigator.mediaDevices.getUserMedia` for mute — never
  fires on Desktop, whose voice pipeline goes through a native addon, not
  the browser's WebRTC path — and `setOutputVolume`/`MediaEngineConnection`
  for deafen) to forging the Gateway voice-state packet directly (op 4),
  ported from Nightcord's `FakeVoice`: `self_mute`/`self_deaf` are now sent
  as `true` independently of your real state, so **others see you as
  muted/deafened while your own mic and audio keep working normally** —
  the opposite direction from before (icon used to stay normal while audio
  was really cut, which never actually worked). Re-asserted automatically
  against Discord's own periodic resync attempts. Menu labels updated to
  match ("icône muette, micro actif" / "icône sourde, audio actif").

### Fixed
- `MicroStudio`'s actual audible feature — raising the voice bitrate — was
  off by default, hidden behind a toggle separate from the four DSP options
  (echo/noise/gain/Krisp) that people naturally reach for first. Those four
  mostly matter for music, not speech, so enabling only them and expecting
  a "LightCord-like" richer sound produced no noticeable change. Bitrate
  boost now defaults to on at 256kbps.
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
  plugins instead of ours. Turned out the option wasn't showing up in the
  dropdown at all afterwards: its visibility also required `!IS_STANDALONE`,
  a flag that's `true` for every build actually distributed through the
  injector (the only way anyone but a from-source dev ever runs Abyss) —
  hiding it for 100% of real users. Dropped that condition entirely.
- Video/GIF playback stutter (~2fps) caused by `maxPerformance`'s
  `disable-gpu-vsync` flag decoupling frame presentation from the display's
  refresh rate — isolated into the new opt-in `uncapFrameRate` setting
  (off by default) so `maxPerformance`'s other flags stay safe to leave on.
- `AntiMoveDeco`'s header-bar icon didn't match the size of other header
  icons, and silently did nothing when clicked outside a voice channel
  instead of telling the user why.
- `TokenImporter`'s modal and `MultiInstance`'s native/icon handling
  redesigned/hardened.
- `injector/` (v0.2.1) — plugin-preset import silently did nothing if Abyss
  was still running: the still-open process resaved its own in-memory state
  over `settings.json` right after the import wrote to it. Import now closes
  every known Discord/Abyss branch before writing and relaunches them after.
  Brand-new installs (no `settings.json` yet on the machine) now also get a
  ready-to-use default plugin pack applied automatically right after their
  first launch, instead of needing a manual export/import round-trip.
  Splash screen's black-hole video background is now unified with the rest
  of the app (was framed/panelled only on the list and settings screens);
  the settings gear icon is hidden on the splash screen and aligned with the
  "Abyss" wordmark on the list screen.
- `injector/` (v0.2.2) — self-update showed a full NSIS installer wizard
  instead of updating silently in the background: the updater plugin's
  Windows install mode wasn't set, so it fell back to Tauri's "passive"
  default instead of fully silent. Now explicitly `quiet` (`/S`), no window
  pops up at all.
- `injector/` (v0.2.3) — re-injecting an already-patched install (updating
  Discord Canary in testing) could fail with "Accès refusé (os error 5)":
  Windows can hold the file handle on `app.asar` a bit longer than expected
  right after killing the process (antivirus scanning the exe that just
  exited is a common cause), and the existing retry budget (~1.5s) wasn't
  always enough. Bumped to a much more generous ~6s of retries before
  actually giving up.
- `injector/` (v0.2.4) — the "Mettre à jour Abyss" banner only refreshed the
  cached build in the background, without ever re-injecting any already
  Abyss-patched install: the button looked like it worked (spinner, banner
  disappears) but nothing was actually applied — a real report from a friend
  stuck permanently on "mettre à jour" with no new plugins ever landing. It
  now re-patches every currently Abyss-owned install with the fresh build in
  the same click.
- `injector/` (v0.2.5) — first-time injections could still hit "Accès refusé
  (os error 5)" even after the v0.2.3 retry fix: a brand new, never-seen
  executable is exactly the case where antivirus/SmartScreen cloud checks
  take the longest to release a file lock, well past the previous ~6s
  budget. Retry window extended to ~20s, and the error message (when it
  still happens) now says what to actually check — antivirus quarantine,
  Discord not fully closed, or admin rights if Discord is installed for all
  users — instead of the raw, meaningless OS error text.
- `injector/` (v0.2.6) — the same "Accès refusé" persisted for a friend's
  first-ever injection even after 20s of retries, with no third-party
  antivirus and "accès contrôlé aux dossiers" confirmed off — ruling out
  every previous theory. The remaining suspect: renaming a large file and
  immediately replacing it under the same name is exactly the shape Windows
  Defender's general (always-on) ransomware behavior heuristics are built
  to catch, independent of that specific setting. Backup/restore now uses a
  plain file copy (only needs read access to the source, never an exclusive
  lock) and the new stub is written directly in place over `app.asar`
  instead of swapping files by name.

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
