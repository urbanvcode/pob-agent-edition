# Development

## Repository layout

This repository holds the MCP server (`agent-mcp/`), the installer, tools and docs. The PoB fork is a **git submodule** with its own repository:

| Folder | Repository | Branch | Upstream |
|---|---|---|---|
| `PathOfBuilding/` | `urbanvcode/pob-agent-edition-pob` | `agent` | [PathOfBuildingCommunity/PathOfBuilding](https://github.com/PathOfBuildingCommunity/PathOfBuilding) (remote `upstream`) |
| `agent-mcp/` | here | | Our MCP server (TypeScript, Node 20). Based on [ianderse/pob-mcp](https://github.com/ianderse/pob-mcp), which we shipped as a fork up to 0.1.0 |
| `luajit/` | here | | LuaJIT commit 14d8a7a2 prebuilt for Windows. Newer LuaJIT versions can't read PoB's startup file |
| `tools/` | here | | update, release and dev scripts |

Not committed: `atlastree-export/` (GGG's export, cloned by `tools/update-atlas.ps1`), `luajit-src/`, `dist/`, `mcp-config.json`, shortcuts.

```
AI app (Claude / Codex / ...)
   │  MCP (stdio)
agent-mcp ─── live first ───▶  PoB Agent Edition window  (127.0.0.1:31337, this PC only)
   └──── fallback ─────▶  headless PoB (LuaJIT + PathOfBuilding/src/Agent/Headless.lua)

Both run the same Lua handlers: PathOfBuilding/src/Agent/Handlers/ (Core.lua, Ops.lua, Tools.lua).
```

## Getting the code

```powershell
git clone --recurse-submodules https://github.com/urbanvcode/pob-agent-edition.git
cd pob-agent-edition
git submodule foreach "git checkout agent"
git -C PathOfBuilding remote add upstream https://github.com/PathOfBuildingCommunity/PathOfBuilding.git
cd agent-mcp; npm ci; npm run build; cd ..
.\Install.cmd
```

## Making changes

The maintainer works with two AI sessions per roadmap stage: a working session that commits locally, and a repo-control session that reviews, scans, pushes and releases (see `ROADMAP.md` › "Sessions"). Human contributors use normal pull requests.

1. PoB changes: commit inside the `PathOfBuilding` submodule on its `agent` branch and push it, then commit the new submodule pointer in the root repo (`git add PathOfBuilding`).
2. MCP server changes: `agent-mcp/` is part of the root repo. A tool is a small entry in `agent-mcp/src/tools/` plus, when PoB has to do something new, a handler in `PathOfBuilding/src/Agent/Handlers/Tools.lua`. Add a contract test for it.
3. Add a line to `CHANGELOG.md` under **Unreleased**, and keep `agent-mcp/src/guide.ts` and `AGENTS.md` in sync.
4. Run `tools\check-secrets.ps1` before pushing.

Commit e-mail: use your GitHub no-reply address (`git config user.email <id>+<login>@users.noreply.github.com`) so your personal e-mail never ends up in the history. Turn on GitHub **Settings > Emails > Block command line pushes that expose my email** as a safety net.

## Updating to a new official PoB release

```powershell
powershell -ExecutionPolicy Bypass -File tools\update-pob.ps1 -Check
powershell -ExecutionPolicy Bypass -File tools\update-pob.ps1
```

The script re-applies our commits on the newest official release tag (from the `upstream` remote), runs a compile check and the agent-mcp tests, and keeps a backup branch. This rewrites `agent`, so push it with `git -C PathOfBuilding push --force-with-lease origin agent`, then commit the new submodule pointer here.

Preview commits (upstream work taken early) carry `[upstream-preview: <path>]` in the message and are dropped automatically once an official release contains `<path>`.

The atlas tree comes from GGG's export: `tools\update-atlas.ps1` (`-Check` first).

## Tests

```powershell
cd agent-mcp
npm test             # unit tests + headless contract tests on a fixture build (no window, no network)
npm run test:live    # smoke test against a running PoB Agent Edition window (POB_AGENT_PORT picks the port)
```

`npm test` also fails when the tool definitions grow past 5,000 tokens: they are loaded into the AI's context in every conversation.

Don't run PoB's `HeadlessWrapper.lua` directly: its `Inflate` stub zeroes the timeless jewel caches. `PathOfBuilding/src/Agent/Headless.lua` wraps it with a real one. If numbers look wrong, check that `src/Data/TimelessJewelData/*.bin` aren't 0 bytes.

Dev helpers: `tools\restart-pob.ps1 [-Background]`, `tools\snap-pob.ps1` (screenshot). To test without touching a window that has unsaved changes, start a second instance with `POB_AGENT_PORT=31338`.

## Releasing

Every finished roadmap stage is released: one minor version per stage (0.2.0, 0.3.0, ...), with patch releases (0.2.1) for fixes in between.

1. Move the **Unreleased** entries in `CHANGELOG.md` to a new `## [x.y.z] - YYYY-MM-DD` section and update the compare links at the bottom.
2. Commit, then run:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -Version x.y.z            # build dist\*.zip only
powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -Version x.y.z -Publish   # + tag + GitHub release
```

The release is built from committed code only (`git archive`), after a secret scan. Releases are published as **Latest** (shown in the repo sidebar); add `-PreRelease` for a test build that should not be Latest. The in-app updater offers both.
