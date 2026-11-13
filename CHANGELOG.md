# Changelog

All notable changes to PoB Agent Edition are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Each release also lists the official Path of Building Community version it is based on.

## [Unreleased]

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

#### MCP server (pob-mcp)
- Live mode: every `lua_*` tool works on the build in the PoB Agent Edition window. New tools: `live_status`, `live_open_build`, `live_save_build`, `live_set_view` (including the OVERVIEW and COMPARE tabs).
- `plan_upgrades`: searches instant-buyout trade listings, simulates each item in the build and ranks the results by gain per chaos.
- Atlas tools: `atlas_get` (points per mechanic, combined bonuses, share link), `atlas_search`, `atlas_edit`.
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
