# Third-party notices and licenses

PoB Agent Edition combines several projects. Each part keeps its own license.

| Part | Where | License | Source |
|---|---|---|---|
| Path of Building Community (our fork) | `PathOfBuilding/` | MIT. The full text, including the licenses of the bundled runtime libraries, is in `PathOfBuilding/LICENSE.md` | https://github.com/PathOfBuildingCommunity/PathOfBuilding |
| pob-mcp by ianderse (ported code) | `agent-mcp/` (trade client, rate governor, item text, upgrade planner, player profile) and `PathOfBuilding/src/Agent/Handlers/` (`Ops.lua`, `Core.lua`) and `PathOfBuilding/src/Agent/Headless.lua`. Each ported file names its pob-mcp original in its header. Our MCP server replaced our pob-mcp fork in 0.2.0 and is based on and inspired by it | GPL-3.0, the same license as this repository ([LICENSE](LICENSE)) | https://github.com/ianderse/pob-mcp |
| LuaJIT (commit 14d8a7a2, prebuilt) | `luajit/` | MIT, see `luajit/COPYRIGHT` | https://luajit.org/ |
| Node.js packages (release zip only) | `agent-mcp/node_modules/` | Each package's own license, included in its folder | npm |
| Passive and atlas tree data, game art | `PathOfBuilding/src/TreeData/` and others | © Grinding Gear Games. Published by GGG for community tools and used the same way as Path of Building Community uses it | https://github.com/grindinggear/skilltree-export, https://github.com/grindinggear/atlastree-export |

## This repository

The installer, tools, documentation and the combined distribution are licensed under the **GNU General Public License v3.0** ([LICENSE](LICENSE)). GPL-3.0 is required because the distribution includes code ported from pob-mcp (GPL-3.0). The MIT-licensed parts are compatible with it and keep their MIT notices.

What this means if you share the release zip:
- Keep all license files (`LICENSE`, `PathOfBuilding/LICENSE.md`, `luajit/COPYRIGHT`), this file, and the pob-mcp credit in the ported files' headers.
- The source code must be available to the people you give it to. The release zip already contains the full source of the PoB fork and of `agent-mcp`.
- Modified versions must also be released under GPL-3.0.

## Trademarks

Path of Exile and Grinding Gear Games are trademarks of Grinding Gear Games. Path of Building is the name of the community project. This project is not affiliated with or endorsed by either.
