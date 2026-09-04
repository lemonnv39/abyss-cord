# Ripcord binary analysis (0.4.29) — multi-account / voice-follow research

Analyzed for GhostAccount redesign research: does Ripcord (a proprietary
Qt/C++ multi-protocol chat client supporting Discord, IRC, and Slack) have a
mechanism where one account automatically follows another into a voice
channel? Source is closed — `C:\Users\lemonn\Desktop\ripcord\Ripcord_Win_0.4.29`
ships only `Ripcord.exe` and Qt/DLL dependencies, no readable source. Analysis
was done via printable-string extraction from the binary (~18,230 strings),
the same technique used earlier on Lightcord's `discord_voice.node`.

## Finding: no ghost-follow mechanism exists

No strings matching `VOICE_CHANNEL_SELECT`, `joinVoice`, `autoJoin`, `follow`,
`relay`, or `mirror` (in the multi-account sense) were found. Ripcord's
multi-account support is parallel account management only: each account gets
its own tab and its own Discord gateway WebSocket connection inside the same
process, switched between manually. Nothing in the binary automates one
account's voice state based on another's.

**Conclusion: nothing to port from Ripcord for the "second account follows
the main account into voice" behavior.** Whatever GhostAccount's redesign
ends up doing, it has to be built from scratch — no reference implementation
exists in Ripcord (matching the same conclusion reached earlier for
Lightcord).

## Secondary findings (confirmed, not new)

- Ripcord's local voice_state table schema: `deaf`, `mute`, `self_deaf`,
  `self_mute` are four independent boolean columns
  (`insert or replace into voice_state (session_id, user_id, channel_id,
  guild_id, deaf, mute, self_deaf, self_mute)`). This confirms `self_mute`
  and `self_deaf` are independent flags at the protocol level, consistent
  with what Abyss's own FakeVoice/GhostAccount work already assumed — no new
  information, just corroboration from a second independent client
  implementation.
- Ripcord actively **prevents** reusing the same token across two active
  accounts ("Token already in use" / "This token is already in use by
  another account.") — the opposite choice from Abyss's MultiInstance, which
  allows opening the same account's token in its own window freely.
- Architecturally, Ripcord does not reuse Discord's official client at all:
  it is a from-scratch native reimplementation of the gateway/voice protocol
  (raw WebSocket, `opus.dll` for audio codec, no Electron, no
  `discord_voice.node`). This is fundamentally different from Abyss's
  approach (patching the real Discord Electron client via MultiInstance
  windows), so Ripcord's account-tab architecture isn't something that can
  be transplanted into Abyss even if it did have a follow feature.

## Relevance to future GhostAccount work

When GhostAccount gets rebuilt, do not spend time re-investigating Ripcord or
Lightcord for a "how do they do it" reference — both were already checked and
neither has anything to offer here. The follow-into-voice behavior, if
rebuilt, has to be original design work (Flux dispatch of
`VOICE_CHANNEL_SELECT` mirroring the main account's channel, as the previous
GhostAccount implementation did before it was removed).
