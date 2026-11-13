# agent-mcp: the PoB Agent Edition MCP server

The MCP server that lets AI assistants (Claude, Codex, any MCP client) read, analyse and change a
Path of Exile 1 build in **PoB Agent Edition**. It is part of
[pob-agent-edition](https://github.com/urbanvcode/pob-agent-edition); players install it with `Install.cmd`.

- **Live first.** It talks to the PoB Agent Edition window on `127.0.0.1:31337` (this PC only). Edits show
  up in the window at once. When PoB is closed it starts a headless PoB and works on saved build files.
- **31 focused tools**, about 3,000 tokens of tool definitions (a test fails above 5,000).
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
| Profile | `profile_get`, `profile_set`, `profile_mark_learned` |
| Session | `status`, `list_builds`, `open_build`, `save_build`, `set_view`, `open_options` |
| Read | `build_summary`, `stats`, `diagnose`, `tree_search` |
| Edit and simulate | `edit_items`, `edit_skills`, `edit_tree`, `set_config`, `what_if`, `snapshot`, `restore`, `compare` |
| Advice | `suggest_passives`, `anoint`, `affixes` |
| Trade | `leagues`, `trade_search`, `plan_upgrades`, `price_check` |
| Atlas | `atlas_get`, `atlas_search`, `atlas_edit` |

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
  `Tools.lua` (summary, diagnose, edits, what-if, suggestions).

## Build and test

```powershell
npm ci
npm run build
npm test            # unit tests + headless contract tests on tests/fixtures (no window, no network)
npm run test:live   # smoke test against a running PoB Agent Edition window
```

Run it by hand: `node build/index.js` (speaks MCP on stdin/stdout).

## Settings (environment variables, all optional)

| Variable | Default | Meaning |
|---|---|---|
| `POB_DIRECTORY` | `Documents/Path of Building/Builds` | Builds folder (the installer sets it) |
| `POB_LIVE` | `auto` | `auto`: the window when open, else headless. `only`: never headless. `off`: always headless |
| `POB_AGENT_PORT` | `31337` | Port of the PoB window's live API |
| `POB_PATH`, `POB_CMD` | found next to this folder | PoB's `src` folder and the LuaJIT executable |
| `POB_AGENT_SETTINGS` | `<user folder>/AgentEdition.json` | Profile and POESESSID file |
| `POB_AGENT_CACHE` | `<user folder>/AgentCache` | Snapshots |
| `POB_TIMEOUT_MS` | `60000` | How long to wait for PoB |
| `POE_TRADE_MAX_REQUESTS_PER_CALL` | `16` | Trade requests per question |
| `POE_SESSION_ID` | from PoB's Options | Overrides the POESESSID |

## Adding a tool

1. If PoB has to do something new, add a handler to `PathOfBuilding/src/Agent/Handlers/Tools.lua`.
2. Add the tool to a file in `src/tools/`: short description, minimal schema, numbers-first text output,
   errors that say what to do next, and the config assumptions in the result.
3. Add a contract test in `tests/contract.test.mjs` and the name to the list in `tests/unit.test.mjs`.
4. Mention it in `src/guide.ts` and `AGENTS.md` if the AI should reach for it unprompted.
