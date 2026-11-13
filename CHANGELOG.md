# Changelog

All notable changes to PoB Agent Edition are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Each release also lists the official Path of Building Community version it is based on.

## [Unreleased]

Stage 16: our own MCP server. **After updating, run `Install.cmd` again and restart your AI app** so it connects to the new server.

### Added
- **`agent-mcp`, our own MCP server**, replaces the pob-mcp fork. It is built around the PoB Agent Edition window: 31 focused tools instead of 115, and about 3,000 tokens of tool definitions instead of about 16,000, so every AI conversation starts lighter and answers get shorter. It is based on and inspired by [pob-mcp](https://github.com/ianderse/pob-mcp) by ianderse (GPL-3.0), from which the build operations, the trade client and other parts are ported. Thank you!
- `diagnose`: the whole health check in one call, in priority order (resistances, max hit and EHP, recovery and mana, damage), with a list of findings.
- `what_if`: try any mix of gear, gem, passive and config changes, see before/after numbers, and the build is rolled back exactly. Nothing flickers in the window.
- `edit_items`, `edit_skills`, `edit_tree` and `set_config` change the open build and report before/after numbers. `edit_tree` takes the shortest path to a passive and picks mastery effects.
- `suggest_passives` (nearby notables, keystones and mastery effects ranked by gain per point), `anoint` (best amulet anoints with oil recipes) and `affixes` (affix tiers and crafting-bench mods from PoB's data).
- `snapshot`, `restore` and `compare` (current build, snapshots or saved builds: stats, tree, items, gems). Comparing never touches the window.
- `trade_search` takes stat filters as plain text and can simulate each result in a gear slot. `price_check` shows the cheapest instant-buyout listings and warns about bait prices.
- Every result names the config it was calculated with (enemy, charges, active flasks).
- The server finds PoB by itself: the AI app's config is one line, with no paths to LuaJIT or PoB. It switches to the PoB window as soon as you open it (no reconnect step), and works on saved build files when PoB is closed.
- `open_build` can import a PoB export code. It refuses to replace unsaved changes unless you agree.

### Changed
- Tool names are shorter (`status`, `open_build`, `save_build`, `set_view`, `stats`, `leagues`, ...). The old `lua_*` and `live_*` tools are gone; see `AGENTS.md`.
- `save_build` never overwrites your file by accident: AI changes need a new name unless you ask for an overwrite.
- Trade searches are instant buyout only, with no setting to turn that off. Pace and limits are unchanged (1 request per 2 seconds, inside every limit pathofexile.com publishes, 16 per question).
- Trade tools use the profile league, or the current challenge league when none is set.
- The PoB window no longer loads anything from the MCP server's folder: its AI handlers live in the PoB fork (`src/Agent/Handlers/`).

### Removed
- The `pob-mcp` folder and its 115 tools. Watch mode, poe.ninja arbitrage, shopping lists, crafting advisors, levelling plans, cluster-jewel and Watcher's Eye advisors, boss readiness and config presets are not in the new server; the roadmap rebuilds them in their own stages (optimiser, economy, crafting, levelling, farming). You can delete the old `pob-mcp` folder after running `Install.cmd`.

### Fixed
- Turning a flask on or off through the AI now changes the calculated numbers at once (before, only after reloading the build).
- Choosing a mastery effect through the AI no longer drops tattoos and other passive overrides.

## [0.1.0] - 2026-11-13

First private preview. Based on **Path of Building Community v2.67.2**, with the 3.30 passive trees taken early from [PoB PR #10437](https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10437).

### Added

#### PoB Agent Edition (the PoB window)
- Live API inside the PoB window (`127.0.0.1:31337`, this PC only), so AI tools read and edit the open build and the changes appear right away.
- Overview dashboard with a dark theme: damage by type, interactive cards, skills, gear and ailments.
- In-game style inventory with item icons.
- **AI Advisor** card that shows the ranked results of `plan_upgrades`.
- Atlas tab: atlas passive tree planner with GGG's official 3.30 data. You can drag, zoom, allocate by shortest path, search, import and copy official links, and open a summary of points per mechanic, notables and combined bonuses. It is saved inside the build.
- Atlas card on the Overview. The newest atlas data version is detected automatically.
- Options: trade session ID (POESESSID), stored locally in `Documents\Path of Building\AgentEdition.json`.
- **Agent profile** in Options: play mode (trade, SSF or mixed), Hardcore or Softcore, league, currency, goals, PoE experience and explanation mode (Teach, Concise or Deep dive). Every AI app shares it, and it shows as chips in the Overview header. The `open_options` live action opens it.

#### MCP server (pob-mcp)
- Live mode: every `lua_*` tool works on the build in the PoB Agent Edition window. New tools: `live_status`, `live_open_build`, `live_save_build`, `live_set_view` (including the OVERVIEW and COMPARE tabs).
- `plan_upgrades`: searches instant-buyout trade listings, simulates each item in the build and ranks the results by gain per chaos.
- Atlas tools: `atlas_get` (points per mechanic, combined bonuses, share link), `atlas_search`, `atlas_edit`.
- Player profile tools: `profile_get` (the profile plus "how to answer" rules for each mode), `profile_set` (checks the league against pathofexile.com) and `profile_mark_learned` (so a PoE1 mechanic is explained only once). `live_status` shows a profile line. `plan_upgrades` defaults to the profile's league and warns in SSF.
- Built-in agent guide that tells any AI client the diagnosis order, the trade safety rules and how to explain PoE1 to PoE2 players.
- Reads the POESESSID from PoB Agent Edition when `POE_SESSION_ID` is not set.
- Trade searches default to instant buyout (`POE_TRADE_ONLINE_STATUS=securable`).

#### Project
- One-step Windows installer (`Install.cmd`) with Start menu and desktop shortcuts and automatic MCP setup for Claude Desktop, Claude Code and Codex.
- `tools/update-pob.ps1` re-applies our changes on the newest official PoB release, then runs a compile check and a smoke test.
- `tools/update-atlas.ps1` pulls GGG's official atlas tree export.
- `tools/build-release.ps1` builds the release zip.

### Changed
- Trade API requests stay inside every rate limit pathofexile.com publishes (at most 1 request every 2 seconds and 16 per question), and the per-window rate governor was fixed.

### Fixed
- `get_build_issues` only counts jewel sockets on allocated passives.

[Unreleased]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/urbanvcode/pob-agent-edition/releases/tag/v0.1.0
