# Development

## Repository layout

This repository holds the installer, tools and docs. The two forks are **git submodules** with their own private repositories:

| Folder | Repository | Branch | Upstream |
|---|---|---|---|
| `PathOfBuilding/` | `urbanvcode/pob-agent-edition-pob` | `agent` | [PathOfBuildingCommunity/PathOfBuilding](https://github.com/PathOfBuildingCommunity/PathOfBuilding) (remote `upstream`) |
| `pob-mcp/` | `urbanvcode/pob-agent-edition-mcp` | `agent` | [ianderse/pob-mcp](https://github.com/ianderse/pob-mcp) (remote `upstream`) |
| `luajit/` | here | | LuaJIT commit 14d8a7a2 prebuilt for Windows. Newer LuaJIT versions can't read PoB's startup file |
| `tools/` | here | | update, release and dev scripts |

Not committed: `atlastree-export/` (GGG's export, cloned by `tools/update-atlas.ps1`), `luajit-src/`, `dist/`, `mcp-config.json`, shortcuts.

```
AI app (Claude / Codex / ...)
   │  MCP (stdio)
pob-mcp  ──── live mode ────▶  PoB Agent Edition window  (127.0.0.1:31337, this PC only)
   └──── fallback ─────▶  background engine (LuaJIT + PathOfBuilding/src)
```

## Getting the code

```powershell
git clone --recurse-submodules https://github.com/urbanvcode/pob-agent-edition.git
cd pob-agent-edition
git submodule foreach "git checkout agent"
git -C PathOfBuilding remote add upstream https://github.com/PathOfBuildingCommunity/PathOfBuilding.git
git -C pob-mcp remote add upstream https://github.com/ianderse/pob-mcp.git
.\Install.cmd
```

## Making changes

The maintainer works with two AI sessions per roadmap stage: a working session that commits locally, and a repo-control session that reviews, scans, pushes and releases (see `ROADMAP.md` › "Sessions"). Human contributors use normal pull requests.

1. Commit inside the submodule on its `agent` branch and push it (`git -C pob-mcp push origin agent`).
2. In the root repo, commit the new submodule pointer (`git add pob-mcp`) together with a line in `CHANGELOG.md` under **Unreleased**.
3. Keep `pob-mcp/src/server/agentGuide.ts` and `AGENTS.md` in sync.
4. Run `tools\check-secrets.ps1` before pushing.

Commit e-mail: use your GitHub no-reply address (`git config user.email <id>+<login>@users.noreply.github.com`) so your personal e-mail never ends up in the history. Turn on GitHub **Settings > Emails > Block command line pushes that expose my email** as a safety net.

## Updating to a new official PoB release

```powershell
powershell -ExecutionPolicy Bypass -File tools\update-pob.ps1 -Check
powershell -ExecutionPolicy Bypass -File tools\update-pob.ps1
```

The script re-applies our commits on the newest official release tag (from the `upstream` remote), runs a compile check and the bridge smoke test, and keeps a backup branch. This rewrites `agent`, so push it with `git -C PathOfBuilding push --force-with-lease origin agent`, then commit the new submodule pointer here.

Preview commits (upstream work taken early) carry `[upstream-preview: <path>]` in the message and are dropped automatically once an official release contains `<path>`.

The atlas tree comes from GGG's export: `tools\update-atlas.ps1` (`-Check` first).

## Tests

```powershell
cd pob-mcp
npm run test:smoke      # headless bridge + MCP smoke test
npx jest tests/unit
```

Don't run PoB's `HeadlessWrapper.lua` directly without pob-mcp's Inflate fix (it zeroes the timeless jewel caches). If numbers look wrong, check that `src/Data/TimelessJewelData/*.bin` aren't 0 bytes.

Dev helpers: `tools\restart-pob.ps1 [-Background]`, `tools\snap-pob.ps1` (screenshot). To test without touching a window that has unsaved changes, start a second instance with `POB_AGENT_PORT=31338`.

## Releasing

Every finished roadmap stage is released: one minor version per stage (0.2.0, 0.3.0, ...), with patch releases (0.2.1) for fixes in between.

1. Move the **Unreleased** entries in `CHANGELOG.md` to a new `## [x.y.z] - YYYY-MM-DD` section and update the compare links at the bottom.
2. Commit, then run:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -Version x.y.z            # build dist\*.zip only
powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -Version x.y.z -Publish   # + tag + GitHub release
```

The release is built from committed code only (`git archive`), after a secret scan. Versions below 1.0.0 are published as pre-releases.
