# agent-mcp: the PoB Agent Edition MCP server

The MCP server that lets AI assistants (Claude, Codex, any MCP client) read, analyse and change a
Path of Exile 1 build in **PoB Agent Edition**. It is part of
[pob-agent-edition](https://github.com/urbanvcode/pob-agent-edition); players install it with `Install.cmd`.

- **Live first.** It talks to the PoB Agent Edition window on `127.0.0.1:31337` (this PC only). Edits show
  up in the window at once. When PoB is closed it starts a headless PoB and works on saved build files.
- **26 focused tools**, about 3,050 tokens of tool definitions (a test fails above 3,100; the rest of the
  5,000-token cap is reserved for Stages 5-8 and 11, see ROADMAP.md › Stage 16 budget note).
- **PoB does the maths.** Every number is PoB's own calculation; every result names the config it used.
- **Account safety.** Instant-buyout listings only, 1 trade request per 2 seconds, inside every limit
  pathofexile.com publishes, 16 requests per question, no whispers, no game-client access. The POESESSID
  is read from PoB's settings file and never printed.

## Credits

**Based on and inspired by [pob-mcp](https://github.com/ianderse/pob-mcp) by ianderse and its
contributors (GPL-3.0).** PoB Agent Edition shipped a fork of pob-mcp up to version 0.1.0. This server
replaced it in 0.2.0 and keeps code ported from it: the Lua build operations
(`PathOfBuilding/src/Agent/Handlers/Ops.lua`, `Core.lua`), the headless runner, the trade client, the
upgrade planner and more. Each ported file names its pob-mcp original in its header. Thank you!

All calculations and game data come from
[Path of Building Community](https://github.com/PathOfBuildingCommunity/PathOfBuilding).

License: GPL-3.0-or-later (see `LICENSE` at the repository root).

## Tools

| Group | Tools |
|---|---|
| Profile | `profile` (read; fields = change; `learned` = topics explained) |
| Session | `status`, `list_builds`, `open_build`, `save_build`, `set_view` (`OPTIONS` opens Options) |
| Character | `character` (sync; `history: true` = timeline) |
| Read | `build_summary`, `stats`, `diagnose`, `tree_search` |
| Edit and simulate | `edit` (item, skill, tree and config ops), `set_config`, `what_if`, `snapshot` (`restore: true`), `compare` |
| Advice | `suggest` (`kind`: passives, anoint, gems, jewel, abyss, watchers_eye, cluster), `affixes`, `optimise` |
| Guides | `guide` (`source` = import, default = compare, `next: true` = next steps) |
| Trade | `trade_search`, `plan_upgrades`, `prices` (item price, currency rates, `leagues: true`) |
| Atlas | `atlas` (read; `query` = search; `add`/`remove`/`replace`/`link` = change) |
| Knowledge | `kb_lookup`, `kb_patch` |

Merged tools route to the original handlers, and the 0.8.0 names (`profile_get`, `edit_tree`, `suggest_gems`,
`atlas_get`, `guide_compare`, `currency`, ...) still work as hidden aliases (`ALIASES` in `src/tools/index.ts`).
When the PoB chat panel runs with "AI may edit" off, the server starts with `POB_READ_ONLY=1` and refuses every
call that would change, open or save a build (tools mark this with `writes`).

The working rules for the AI (diagnosis order, profile, trade safety, saving) are sent as server
instructions (`src/guide.ts`); `AGENTS.md` at the repository root is the human-readable copy.

## How it fits together

```
AI app ── MCP (stdio) ── agent-mcp ── JSON lines ──▶ PoB Agent Edition window (Agent/LiveServer.lua)
                                  └─ or ──────────▶ headless PoB (luajit Agent/Headless.lua)
                                                     both run PathOfBuilding/src/Agent/Handlers/
```

- `src/pob.ts`: the connection. Checks for the window on every call, so opening or closing PoB in the
  middle of a conversation just works.
- `src/tools/`: one small entry per tool (name, description, schema, handler returning text).
- `src/trade/`: the trade client, rate governor and upgrade planner.
- `src/profile.ts`: the player profile and POESESSID in `Documents/Path of Building/AgentEdition.json`
  (same schema as `PathOfBuilding/src/Agent/Settings.lua`).
- PoB side: `PathOfBuilding/src/Agent/Handlers/Core.lua` (basic requests), `Ops.lua` (build operations),
  `Tools.lua` (summary, diagnose, edits, what-if, suggestions), `Advice.lua` (support gems, boss check, jewels,
  item affixes, notes).

## Knowledge engine (`src/knowledge/`)

`kb_lookup` and `kb_patch` return game facts that can be cited: each has a `source`, a `url`, the `game`
and `game_version` it describes and `retrieved_at`. Nothing in an answer comes from the engine itself.

| Rank | Source | What is read | File |
|---|---|---|---|
| 1 | Installed game | Only whether and when the client was patched (Steam manifest or `Content.ggpk` time), as the signal to re-check the version. Read-only; the path is never shown | `sources/game.ts` |
| 2 | GGG, pathofexile.com | The patch-notes forum: thread list and the staff post of a thread (never player replies) | `sources/ggg.ts` |
| 3 | Path of Building data | Uniques and gems from `PathOfBuilding/src/Data` (no network) | `sources/pobdata.ts` |
| 4 | [poedb.tw](https://poedb.tw) | A page's item box and version history (unofficial, datamined) | `sources/poedb.ts` |
| 5 | [poewiki.net](https://www.poewiki.net), [poe2wiki.net](https://www.poe2wiki.net) | Page text with its last-edit time; the versions table. Community-written, CC BY-NC-SA 3.0: quoted briefly with a link | `sources/poewiki.ts` |

- `fetcher.ts`: one polite fetcher for all sites. It obeys robots.txt (a disallowed address is never
  requested), sends one request at a time with a pause per site, caches every page on disk
  (`AgentCache/knowledge/http`), caps the requests of one question, never retries a site that answered
  429 or 503, and identifies itself as `pob-agent-edition/<version> (agent-mcp)`.
- `versions.ts`: the live game version (GGG's forum plus the wiki's release dates). Cached pages are tied
  to the version they were read under, so a patch makes them count as old.
- `engine.ts`: lookup (glossary, PoB, wiki, poedb, patch notes that name the topic; outdated and
  conflicting facts flagged), claim check, patch notes for a league or for the names in a build.
- `glossary-data.ts`: 62 PoE1 terms with a short quoted source and a PoE2 comparison.
- `answers.log` in the cache folder lists which sources each answer used.

## Build and test

```powershell
npm ci
npm run build
npm test            # unit tests + headless contract tests on tests/fixtures (no window, no network)
npm run test:live   # smoke test against a running PoB Agent Edition window
npm run test:kb     # knowledge engine against the live sites: parsers, glossary quotes, 121 questions
```

Run it by hand: `node build/index.js` (speaks MCP on stdin/stdout).

## Settings (environment variables, all optional)

| Variable | Default | Meaning |
|---|---|---|
| `POB_DIRECTORY` | `Documents/Path of Building/Builds` | Builds folder (the installer sets it) |
| `POB_LIVE` | `auto` | `auto`: the window when open, else headless. `only`: never headless. `off`: always headless |
| `POB_AGENT_PORT` | `31337` | Port of the PoB window's live API |
| `POB_READ_ONLY` | off | `1`: refuse calls that change, open or save a build (the chat panel with edits off) |
| `POB_PATH`, `POB_CMD` | found next to this folder | PoB's `src` folder and the LuaJIT executable |
| `POB_AGENT_SETTINGS` | `<user folder>/AgentEdition.json` | Profile and POESESSID file |
| `POB_AGENT_CACHE` | `<user folder>/AgentCache` | Snapshots and the knowledge cache |
| `POB_KB_OFFLINE` | off | `1`: knowledge tools use only what is cached |
| `POB_KB_INTERVAL_MS`, `POB_KB_MAX_REQUESTS` | `1500`, `8` | Pause between requests to one site; requests per question |
| `POB_KB_GAME`, `POB_KB_LOG` | on | `off`: do not look for the installed game; do not write `answers.log` |
| `POB_TIMEOUT_MS` | `60000` | How long to wait for PoB |
| `POE_TRADE_MAX_REQUESTS_PER_CALL` | `16` | Trade requests per question |
| `POE_SESSION_ID` | from PoB's Options | Overrides the POESESSID |

## Adding a tool

1. If PoB has to do something new, add a handler to `PathOfBuilding/src/Agent/Handlers/Tools.lua`.
2. Add the tool to a file in `src/tools/`: short description, minimal schema, numbers-first text output,
   errors that say what to do next, and the config assumptions in the result.
3. Make it public in `src/tools/index.ts`. If it overlaps an existing tool, add a mode to that tool with
   `routed(...)` instead of a new name (every definition costs tokens in every conversation). Mark tools
   that change, open or save a build in `WRITES`.
4. Add a contract test in `tests/contract.test.mjs` and the name to the list in `tests/unit.test.mjs`.
   Stay inside your stage's share of the token budget (ROADMAP.md › Stage 16 budget note) and raise
   `TOOL_BUDGET` in `tests/unit.test.mjs` by that share only.
5. Mention it in `src/guide.ts` (about 50 tokens per stage) and `AGENTS.md` if the AI should reach for it unprompted.
