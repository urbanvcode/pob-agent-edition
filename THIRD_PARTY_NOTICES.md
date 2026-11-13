# Third-party notices and licenses

PoB Agent Edition combines several projects. Each part keeps its own license.

| Part | Where | License | Source |
|---|---|---|---|
| Path of Building Community (our fork) | `PathOfBuilding/` | MIT. The full text, including the licenses of the bundled runtime libraries, is in `PathOfBuilding/LICENSE.md` | https://github.com/PathOfBuildingCommunity/PathOfBuilding |
| pob-mcp (our fork) | `pob-mcp/` | GPL-3.0, see `pob-mcp/LICENSE` | https://github.com/ianderse/pob-mcp |
| LuaJIT (commit 14d8a7a2, prebuilt) | `luajit/` | MIT, see `luajit/COPYRIGHT` | https://luajit.org/ |
| Node.js packages (release zip only) | `pob-mcp/node_modules/` | Each package's own license, included in its folder | npm |
| Passive and atlas tree data, game art | `PathOfBuilding/src/TreeData/` and others | © Grinding Gear Games. Published by GGG for community tools and used the same way as Path of Building Community uses it | https://github.com/grindinggear/skilltree-export, https://github.com/grindinggear/atlastree-export |

## This repository

The installer, tools, documentation and the combined distribution are licensed under the **GNU General Public License v3.0** ([LICENSE](LICENSE)). GPL-3.0 is required because the distribution includes pob-mcp. The MIT-licensed parts are compatible with it and keep their MIT notices.

What this means if you share the release zip:
- Keep all license files (`LICENSE`, `PathOfBuilding/LICENSE.md`, `pob-mcp/LICENSE`, `luajit/COPYRIGHT`) and this file.
- The source code must be available to the people you give it to. The release zip already contains the full source of both forks.
- Modified versions must also be released under GPL-3.0.

## Trademarks

Path of Exile and Grinding Gear Games are trademarks of Grinding Gear Games. Path of Building is the name of the community project. This project is not affiliated with or endorsed by either.
