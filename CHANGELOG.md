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
