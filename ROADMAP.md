# ROADMAP — PoB Agent Edition

The full plan, split into stages and steps so each step can be done in its own chat.
**Starting a new chat?** Read "How to continue in a new chat" at the end, then `AGENTS.md`.

Status: ✅ done · 🔜 next · ⬜ planned · 💭 later

---

## 1. Vision

A Path of Building that any AI (Claude, Codex, Antigravity, or a chat built into PoB) can drive, made for a
player who knows **Path of Exile 2** but is **new to Path of Exile 1**. It should act like an expert coach:

- **Knows the player**: trade or SSF, league, currency, goals, how much explanation they want.
- **Knows the character**: imports it from pathofexile.com, tracks progress over time.
- **Follows a guide** (e.g. Fubgun on Mobalytics): what's missing, what to do next, stage by stage.
- **Min-maxes with real maths**: every suggestion is simulated in PoB before it is recommended.
- **Spends currency well**: best set of purchases for a total budget, or a craft/farm plan in SSF.
- **Coaches levelling, crafting and farming**: act-by-act levelling, step-by-step crafts with costs,
  atlas/farming strategies with profit estimates.
- **Knows PoE**: answers from poewiki/poedb with sources, checked against the player's build.
- **Explains** at the player's chosen level, relating PoE1 to PoE2.
- **Keeps the account safe**: never touches the game client, instant buyout only, polite with GGG's servers.

### Design principles (apply to every feature)
1. **Simulate, don't guess.** Any number shown comes from PoB's calculation of the player's build.
2. **Show the why.** Each recommendation names the mechanic, the before/after numbers and the cost.
3. **Rank by value.** Gain per point, per chaos, per hour, or per step — not just "best".
4. **Respect the mode.** Trade → buying; SSF → crafting/farming/drop targets; Mixed → both, clearly labelled.
5. **Never overwrite** the player's builds; AI changes go to new files or new specs.
6. **Safe by default.** No game-client automation; rate limits; secrets never printed.
7. **Works in every client.** Features live in agent-mcp tools + PoB Agent Edition, so Claude, Codex,
   Antigravity and the in-PoB chat all get them.
8. **PoB base stays official.** Upstream work only as removable previews.
9. **No guessing.** Facts come from current, cited sources (Stage 9 hierarchy: game data > official GGG >
   PoB data > poedb > poewiki); numbers come from PoB. If it can't be sourced, say so. Outdated or
   conflicting facts are flagged, never silently used.

---

## 2. Status overview

| Stage | Name | Status |
|---|---|---|
| 0 | Foundation | ✅ |
| 1 | Player profile & explanation modes | ✅ |
| 2 | Character import & progress sync | ✅ 0.4.0 |
| 3 | Guide mode | ✅ 0.5.0 (Guide mode 2: 0.6.1; Guide tab fixes and Hide panel: 0.8.0) |
| 4 | Optimiser (goal-based min-maxing) | ✅ 0.8.0 |
| 5 | Economy: budgets, trade and SSF | ✅ (built 2026-11-14, not released yet) |
| 6 | Crafting helper | ✅ (built 2026-11-14, not released yet) |
| 7 | Levelling coach | 🔨 engine, data, card done; AI tool next |
| 8 | Farming & money advisor | ⬜ |
| 9 | PoE knowledge (GGG patch notes, PoB data, poedb, poewiki, glossary) | ✅ 0.6.0 |
| 10 | AI chat inside PoB (Claude Code / Codex CLI / API key) | ✅ 0.8.0 |
| 11 | Create a build | ⬜ |
| 12 | UI polish | ⬜ |
| 13 | Data freshness | ✅ 0.7.0 |
| 14 | PoE2 edition | 💭 |
| 15 | Install, portable version & updater | ✅ 0.3.0 |
| 16 | Own MCP server (replace pob-mcp) | ✅ 0.2.0 |
| 17 | Lighter: smaller downloads and updates, less memory, disk and CPU | ✅ 0.8.0 |
| X | Cross-cutting: testing, safety, docs, backups | ongoing |

Stage numbers are names, not the order. **Build order:** 0 ✅ → 1 ✅ → 16 ✅ → 15 ✅ → 2 ✅ → 3 ✅ → 4 ✅ → **5** → 9 ✅ → 7 → 6
→ 8 → 10 → 11 → 12/13 → 14.
- **16 first:** Stages 2-11 each add MCP tools. Built after 16, they are written once on our own server
  instead of on pob-mcp and then ported again, and every chat stops paying about 16,000 tokens of tool definitions.
- **15 second:** the repo is public now, so players need the update reminder. Its AI part (`update_check`)
  is then built on the new server too.
- 2 is small and the later stages use it; 9 makes every later answer better.

**Every finished stage is released on GitHub** (see "Releases" at the end): stage done → changelog → new
minor version (0.2.0, 0.3.0, ...) → `tools\build-release.ps1 -Version x.y.z -Publish`.
v0.1.0 = Stage 0 + Stage 1.

---

## Stage 0 — Foundation ✅ (2026-11-13)

Built:
- **PoB Agent Edition** (`PathOfBuilding/`, branch `agent`): live API 127.0.0.1:31337 (`src/Agent/LiveServer.lua`),
  Overview dashboard (`Classes/OverviewTab.lua`: damage by type, damage sources, inventory with real item icons,
  AI Advisor, Atlas card, skills, ailments/charges, resources, attributes, build health), dark theme
  (`Agent/Theme.lua`), Atlas tab (`Classes/AtlasTab.lua`, `Agent/AtlasData.lua`, GGG 3.30 data, summary,
  import/copy links), 3.30 passive tree **preview**, POESESSID field in Options (`Agent/Settings.lua` →
  `Documents/Path of Building/AgentEdition.json`), item icon cache (`Agent/IconCache.lua`).
- **pob-mcp** (`pob-mcp/`, branch `agent`): ~110 tools, live mode (`POB_LIVE`), polite trade
  (`services/rateGovernor.ts`: 1 req/2 s, server tiers, 16 per question, instant buyout), `plan_upgrades`
  (`handlers/upgradePlanHandler.ts`), atlas tools, shared AI guide (`server/agentGuide.ts`).
- Clients: Claude Code (`~/.claude.json`), Codex (`~/.codex/config.toml`), Antigravity
  (`~/.gemini/antigravity/mcp_config.json`).
- Scripts: `tools/update-pob.ps1` (re-applies our commits on new PoB releases, drops previews when official),
  `tools/update-atlas.ps1`, `tools/restart-pob.ps1`, `tools/snap-pob.ps1`.

Loose ends:
- [ ] Player: save the build in Agent Edition and restart it to see the 3.30 tree, Atlas tab and Advisor.
- [ ] Test Overview hover/click and Atlas with a real mouse; fix issues.
- [ ] Verify a real atlas link (pathofexile.com or a guide) imports correctly — format was reconstructed.
- [ ] Investigate 3 pre-existing failing tests in `pob-mcp/tests/unit/luaReloadBuild.test.ts`.

---

## Stage 1 — Player profile & explanation modes ✅ (2026-11-13)

**Why:** every later feature needs to know trade vs SSF, league, currency, goals and how much to explain.

### Features
- **Profile** (stored in `AgentEdition.json`, editable in PoB and by the AI):
  - play mode: `trade` · `ssf` · `mixed` (mixed = show both, labelled);
  - league (validated with `get_leagues`; "current league" auto-detect);
  - currency on hand (chaos, divines, other; optional, updated by the player or by character sync);
  - goals: e.g. "league start", "farm maps", "kill Uber Elder", "beat all pinnacle bosses";
  - experience: "new to PoE1, knows PoE2" (default for this player);
  - **explanation mode** (3 levels, player choice):
    - **Teach** (default): explain each PoE1 mechanic the first time it matters, compare with PoE2,
      then remember it was explained (a "learned topics" list in the profile, so it isn't repeated);
    - **Concise**: actions + numbers only, one line of why;
    - **Deep dive**: full mechanics and maths (more vs increased, effective DPS formula, EHP layers).
- **Profile panel in PoB**: Options section "Agent profile" (mode, league, currency, explanation level).
- **MCP**: `profile_get`, `profile_set`; the AI guide tells every AI to read the profile first and adapt.
- **Explanation memory**: `profile_mark_learned(topic)` so Teach mode doesn't repeat itself.

### Steps
1. ✅ Profile schema + `Agent/Settings.lua` keys; Options UI section.
2. ✅ pob-mcp `profile_get` / `profile_set` / `profile_mark_learned`; read same JSON.
3. ✅ AI guide: "read profile first; adapt explanation mode; trade vs SSF rules".
4. ✅ Overview header shows mode/league/currency chips (click → Options).

Built:
- Profile under `"profile"` in `AgentEdition.json`: `playMode` (trade/ssf/mixed), `hardcore` (bool), `league` ("" = current
  challenge league), `currency {chaos, divine, other, updated}`, `goals[]`, `experience` (poe2/new/poe1),
  `explanationMode` (teach/concise/deep), `learnedTopics[]`, `updated`. Schema in `Agent/Settings.lua`
  (`normalizeProfile`) and `pob-mcp/src/utils/playerProfile.ts` — keep in sync.
- Options › "Agent profile (AI)" section (mode + Hardcore checkbox, league, chaos/divine, other currency, goals, experience,
  explanations, explained-topics count + Reset). Saving re-reads the file so AI-learned topics are kept.
- Overview header chips (mode, Hardcore/Softcore, league, currency, explanation mode); re-read every 2 s, click opens Options.
- pob-mcp: `profile_get` (profile + "How to answer" rules per mode), `profile_set` (league checked
  against pathofexile.com), `profile_mark_learned`; `live_status` appends a profile line;
  `plan_upgrades` defaults league to the profile and warns in SSF. Live action `open_options`.
- Tests: `tests/unit/playerProfile.test.ts`; smoke passes; checked in a second instance (port 31338).

Loose ends:
- [x] Click **Save** in Options › Agent profile with a real mouse (rendering and the MCP→Overview path were
  verified; the Save click itself couldn't be automated).
- [x] Restart Claude Code / Codex / Antigravity (new tools) and PoB Agent Edition (new UI) to pick it up.
- [x] Set your profile (Options or tell the AI): trade/SSF, hardcore/softcore, league, currency, goals, explanation mode.
- [ ] Maybe: MCP tool `live_open_options` so the AI can open the profile editor for the player.

**Done when:** switching to SSF or Deep dive visibly changes AI answers; profile survives restarts and
is shared by Claude/Codex/Antigravity.

---

## Stage 2 — Character import & progress sync ✅ (2026-11-13, released in 0.4.0)

**Why:** the AI should see the real character, not just a PoB file, and show progress over time.

### Features
- **Import from pathofexile.com**: account + character (public profile), using PoB's own importer
  (Import tab code paths) driven through the live API; option to import into a new build or update the
  "current character" build's items/skills/tree while keeping config.
  (PoB supports OAuth login for private profiles — use PoB's own flow; never handle passwords.)
- **Sync**: one click / one AI request re-imports and shows **what changed** since last time
  (new items, gems levelled, passives added) with DPS/EHP/max-hit deltas.
- **History**: snapshots per sync (`snapshot_build` exists) → timeline of DPS, EHP, life, resists,
  level; Overview "Progress" card with sparkline charts.
- **Guide link**: remember which guide/stage the character follows (Stage 3).
- **Safety**: respects GGG rate limits; read-only; no game-client access.

### Steps
1. ✅ Drive PoB's character import via live action (`character_import`, PoB's own `ImportTab` code), tested with a public profile.
2. ✅ Diff engine: items/gems/passives/stats between two syncs.
3. ✅ History store (`Documents/Path of Building/AgentCache/history/<realm>_<account>_<character>.json` + build XML per sync + `index.json`).
4. ✅ Overview "Progress" card + MCP `character_sync`, `character_history`.

Built:
- **PoB side** (`PathOfBuilding/src/Agent/Handlers/Character.lua`, loaded by `Tools.lua`): `character_import` feeds the
  downloaded JSON into `ImportTab:ImportPassiveTreeAndJewels` / `ImportItemsAndSkills` (all "Delete" boxes ticked, config
  kept, `lastCharacterHash` set); `character_state` returns level, PoB's key stats, items (with a mod fingerprint), gems and
  allocated passives. No network code in Lua: the same handlers run live and headless.
- **agent-mcp** (`src/character.ts`, `src/tools/character.ts`): downloads from the public `character-window` endpoints
  (get-characters, get-items, get-passive-skills = 3 requests), 1 request per 2 s plus a `RateGovernor` that learns the
  `backend-character-request-limit` tiers (15/60 s, 90/30 min, 180/2 h at the time of writing), stops on 429, max one sync
  per character per minute. Imports into its own build `<character> - synced` (created on the first sync, reopened and
  saved on later ones; refuses to replace unsaved changes in the window before any request is made). Diff: items per slot,
  gems by name (level/quality), named passives (keystones, notables, ascendancy, mastery effects) plus a count of small ones,
  DPS/EHP/weakest max hit/life/ES/resists.
- **Overview "Progress" card** (`Agent/ProgressCard.lua`): sparklines for DPS, EHP, max hit and level, change since the
  first sync, per-sync values on hover, last sync's summary. Matched to the build through PoB's `lastCharacterHash`; reads
  `index.json` every 3 s.
- Tests: `agent-mcp/tests/character.test.mjs` (mocked site + headless PoB: private profile, unknown character, 429, the
  limit governor, diff engine, first and second sync, history); real sync of a public character in a second instance.

Loose ends:
- [ ] Private profiles: PoB's OAuth flow ("never handle passwords") is not driven yet; public profile only.
- [ ] Guide link (which guide/stage the character follows) waits for Stage 3.
- [ ] Maybe: a Sync button on the Progress card (the player chose AI-only for now).
- [ ] Currency on hand from character sync (Stage 1 idea) needs the stash API, which requires OAuth.

**Done when:** "sync my character" imports it, lists changes since last sync with numbers, and the
Progress card shows a timeline.

---

## Stage 3 — Guide mode ✅ (2026-11-13, released in 0.5.0)

**Why:** the player follows guides (Fubgun on Mobalytics); the AI should keep them on track.

### Features
- **Guide import**: PoB code or pobb.in / pastebin / poe.ninja link (Mobalytics pages are JS-heavy; the
  player pastes the PoB link from the guide). Multi-stage guides: import each stage
  (leveling, early maps, mid, endgame) as specs/loadouts of one "Guide - <name>" build.
- **Guide notes**: keep the guide's PoB notes (gem swaps, item notes, bandit/pantheon) and surface them.
- **Me vs guide** (`guide_compare`):
  - passives: missing/extra, **ordered into a path** to take next, point cost, respec cost (regret orbs);
  - masteries: different choices;
  - gems: missing supports per skill group, level/quality/awakened gaps, wrong links count;
  - items: per slot — guide unique missing, or rare missing key stats; impact of each simulated in the
    player's build (`test_items`);
  - config differences (charges, flasks, boss settings) that explain number gaps;
  - headline: player vs guide DPS / EHP / max hit / resists with "what explains the gap".
- **Next steps** (`guide_next_steps`): top actions toward the guide weighted by impact ÷ cost
  (points, currency, effort), respecting the profile (trade/SSF, currency).
- **Stage detection**: suggest which guide stage the character is at (level, gear, points).
- **Guide progress card** on the Overview: % passives/gems/key items matched, next 3 steps, click → details.
- **Deviation awareness**: if the player deliberately differs (e.g. different unique), don't nag; remember it.

### Steps
1. ✅ Link/code fetch + decode (the download addresses PoB's own BuildSiteTools.lua uses: pobb.in, poe.ninja,
   pastebin, maxroll, pob.codes, rentry, poedb) → saved as a new "Guide - <name>" build, never over another file;
   several "Stage: link" lines merge into one build whose loadouts are the stages; tests.
2. ✅ Compare engine (`PathOfBuilding/src/Agent/Handlers/Guide.lua`): stages = PoB loadouts (spec + item/skill/config
   set of the same title); passives ordered into a path (nearest first) and simulated step by step; masteries,
   gems (per group, matched by active skill), items and jewels per slot, config; "what explains the gap" = each part
   of the guide applied alone, then all together. Build always rolled back.
3. ✅ Next-steps ranking: passives by gain per point (path order kept), buys by gain per chaos within the budget
   (poe.ninja prices, instant-buyout trade links, no trade API request), SSF = farm/craft targets without prices,
   mixed = both; hardcore weighs EHP double; respec line with Orb of Regret price.
4. ✅ Overview Guide card (`Agent/GuideCard.lua`, reads `AgentCache/guide/card.json`) + MCP tools `guide_import`,
   `guide_compare`, `guide_next_steps` (about 385 tokens) + AI guide text. Stage detection, deviations (`accept`)
   and the guide per build are remembered in `AgentCache/guide/state.json`.

Tested with a real multi-stage guide (Deadeye, 11 loadouts): stage detection, compare,
next steps with "2 div", card in a second window (port 31340). `npm test` runs `tests/guide.test.mjs`.

**Guide mode 2 (released in 0.6.1, player's requests after 0.5.0):**
5. ✅ **Guide tab** in PoB (`Classes/GuideTab.lua`, "Guide" button under Party/Compare): guide + stage pickers (Auto =
   detected), Import guide (link or code, PoB's own build-site downloads), Analyse (same engine as the AI tools),
   the player's tree with the guide stage drawn over it (PoB's compare colours) and the next passives numbered 1, 2, 3,
   click to jump on the tree / open the instant-buyout search, "keep" = accepted deviation. Works without an AI app.
6. ✅ **Priorities by need** (`Guide.lua` priorities/rankPlan): uncapped resistances first, else defence or damage,
   whichever is further behind the guide stage (hardcore leans to defence); **rush** = best target 3+ points away.
7. ✅ **Levelling vs endgame**: levelling stage (title or < 70 points) or character below level 68: stage by level and
   points, no respec counting, links + levelling uniques (no budget ranking), gems by level requirement, next stage's
   new skills with their level, Act 5 / Act 10 resistance penalties.
8. ✅ **Sync character** button + optional auto-sync every 15 min (`Agent/CharacterSync.lua`): 3 requests 2 s apart,
   once a minute at most, 10-minute pause on 429, history in the Stage 2 format.

Loose ends / ideas:
- Changing a chosen mastery: the cost is not verified (shown as "cost not verified"); Stage 9 can source it.
- Jewels are simulated one by one by hand (PoB's item undo state errors when socketed jewels are rolled back),
  so they are not in "all together".
- Guide rares get "needs a price" (trade_search / plan_upgrades price them); a later step could search them directly.
- Link to Stage 2: a synced character could pick its guide automatically.

**Done when:** paste a Fubgun guide → it opens with stages; "what am I missing?" and "what next with
2 divines?" give ranked, simulated answers with links.

---

## Stage 4 — Optimiser (goal-based min-maxing) ✅ (2026-11-13, released in 0.8.0)

**Why:** "How do I increase damage?", "I'm weak at single target", "I keep dying" — answered with PoB maths.

### Features
- **Goal profiles** (temporary config, restored afterwards):
  - *Single target / bossing*: pinnacle boss enemy, boss-relevant buffs (charges, flasks, curses), metric =
    single-target DPS (excludes culling/clear-only damage), optional "uptime" assumptions;
  - *Clear*: combined DPS, AoE/projectile count, movement speed;
  - *Tankiness*: EHP, weakest max hit, phys/ele/chaos split, ailment & stun immunity, recovery;
  - *Balanced* (weighted), *Fix weakest* (from `get_build_issues`).
- **Search space** (everything simulated, ranked by gain per cost):
  - passives within N points (reachable nodes, notables, clusters), with paths;
  - **respecs**: remove low-value nodes to fund better ones (net gain per regret);
  - masteries: best effect per mastery;
  - cluster jewels / timeless jewels (what to look for);
  - gems: support swaps, gem level/quality, awakened, alt setups for bossing vs clear (weapon swap, gem swap);
  - gear: via Stage 5 (trade or craft);
  - anoints, flasks/flask mods, auras/heralds/curses, Pantheon, bandit;
  - config the player forgot (e.g. exposure, shock effect) — flagged as "you may be under-counting".
- **Why it works**: each suggestion tagged with the mechanic (more vs increased, crit, penetration,
  exposure, conversion, DoT vs hit, ailment scaling, EHP layer) and explained per profile mode.
- **Scaling report**: what the build scales well/poorly ("+10% more is worth X% DPS, +1% crit is worth…") —
  marginal value table so the player understands priorities.
- **Advisor tabs**: Items / Passives / Gems / Other in the Overview Advisor card; apply-in-preview
  (shows numbers, saves as new spec or build only when the player says so).

### Steps
1. Goal profiles + temporary config with restore; metric definitions; tests on the LA Deadeye.
2. Passive search (reachable set, path costs, clusters) + respec search.
3. Gem/aura/curse/flask/anoint levers.
4. Marginal-value "scaling report".
5. Advisor tabs + MCP `improve_build {goal, points, budget}` + explanations.

**Built (2026-11-13):** one MCP tool, `optimise { goal, points, levers, budget_chaos, limit }` (about 220 tokens; named
`optimise` instead of `improve_build`), on `PathOfBuilding/src/Agent/Handlers/Optimise.lua`.
1. ✅ Goals: `bossing` (enemyIsBoss = Pinnacle, Uber kept; metric = main-skill CombinedDPS minus culling), `clear`
   (enemyIsBoss = None; DPS + 0.5 x movement speed + 0.25 x area), `tankiness` (0.5 x EHP + 0.5 x weakest max hit + 2 per
   point of uncapped resistance), `balanced`, `weakest` (from `diagnose`: uncapped resists or survivability -> tankiness,
   0 DPS -> bossing; hardcore -> tankiness). Temporary config is set inside one capture/restore, so it is always put back.
   Tested on the OCC Vortex fixture (no LA Deadeye fixture in the repo; the player's builds are not used by tests).
2. ✅ Passives within N points (shared `passiveOptions` with `suggest_passives`), allocated mastery effect swaps, respecs:
   each allocated node's dependants removed (`removeNodes`), cheapest losses per point matched with the best target their
   points can buy, simulated together, cost = Orbs of Regret.
3. ✅ Levers: `suggest_gems` (swaps + levels), quality to 20, auras/heralds/curses as a new group (blocked when the mana
   or life to reserve is missing), equipped flasks switched off (under-counting), plain utility flasks in an empty slot,
   anoints against the current anoint, pantheon and bandit, shown config checkboxes that are off (under-counting).
4. ✅ Scaling report: 19 standard stat lines simulated as a passive.
5. ✅ Advisor tabs (Items / Passives / Gems / Other; `set_advisor { tab, select }`), mechanic tags from the stat text
   mapped to glossary terms; teach mode prints the unlearned glossary entries with source and version, deep mode all.
   Gear: `budget_chaos` runs `plan_upgrades` (Stage 5 hook); SSF gets the scaling report.

Tests: `tests/optimise.test.mjs` (unit + every goal headless, build and config unchanged afterwards); live window on a
second instance: card tabs filled, build and view unchanged. A full run is about 950 simulations in 11-16 s.

Loose ends / ideas:
- Cluster and timeless jewels are not searched by `optimise` (pointer to `suggest_jewels`); flask mods are not searched.
- Gem prices (awakened supports) and oil prices come with Stage 5; until then "buy" items are ranked as one change.
- Anoints use the fast calculation (no full DPS) for speed; numbers can differ slightly from `what_if`.
- Weapon swap / alternative setups for bossing vs clear are not built.

**Done when:** "I'm weak at single target" returns ranked, simulated changes across passives/gems/gear/
config with before/after numbers and explanations at the chosen level.

---

## Stage 5 — Economy: budgets, trade and SSF ✅ (2026-11-14)

### Features
- **Budget input**: "3 div + 150c", or from profile/character sync; converted with poe.ninja rates
  (league-specific, cached).
- **Total-budget planner (trade)**: best *set* of purchases across slots (knapsack on simulated gains),
  diminishing returns handled (re-simulate combined set), resist/attribute requirements kept valid,
  "buy now" vs "save for" (big guide uniques), price sanity (outlier/price-fixing filter, listing age).
- **Price checks for own items**: what the player's items are worth (sell to fund upgrades).
- **SSF mode**: replace buying with: craft plans (Stage 6), farm targets (where a unique/base drops, div
  cards, Atlas strategy — Stage 8), "good enough" thresholds for rares to keep an eye out for (loot filter
  ideas).
- **Mixed mode**: show both "buy for X" and "craft for ~Y" side by side.
- Keep all trade rules (instant buyout only, polite limits, player buys).

### Steps
1. Budget parser + rates; profile currency.
2. Combined-set optimiser with re-simulation; requirement checks.
3. Own-item price check; sell suggestions.
4. SSF/mixed outputs (hooks to Stages 6/8).

**Done when:** "I have 3 div" → a plan ≤ budget with combined gain; SSF profile → craft/farm plan instead.

**Built (2026-11-14):** no new tool (78 tokens): `plan_upgrades { budget }` and `prices { own: true }`; engine in
`agent-mcp/src/economy/` and `PathOfBuilding/src/Agent/Handlers/Economy.lua`.
1. ✅ Budget parser (`"3 div + 150c"`, `"1.5k"`, `"20 ex, 2 div"`, `"all"` = profile currency incl. `other`); poe.ninja rates
   and unique/gem prices cached per league in memory and on disk (`AgentCache/economy`, 30 min / 2 h; an older copy up to
   3 days is used and said when poe.ninja is down). The guide planner uses the same parser.
2. ✅ Set planner: one PoB-weighted search per slot (price <= the total, 2 trade requests per slot, limits unchanged),
   knapsack with one item per slot, the set simulated together (`what_if`, rolled back), repaired when resistances,
   attribute requirements or mana break (hardcore: EHP loss), a few swap improvements (max 30 simulations), "save for" =
   better items that did not fit. Price sanity: bait / price-fixing (< 50% of the median), wishful (> 300%) and stale
   (> 14 days) listings set aside; buy warnings for a unique far below its peers or listed > 30 days ago.
3. ✅ Own items: uniques (name, base, 5L/6L) and gems (level/quality; never above a strictly better version) from
   poe.ninja, no trade requests; rares "price by hand"; "sell after buying" for what the plan replaces.
4. ✅ SSF: per slot the stats a top roll is worth most for (PoB's weights x the item class's roll range, from
   `Data/QueryMods.lua`) with "alone beats the current item" thresholds; mixed adds [SSF] craft (Stage 6) / farm
   (Stage 8) hooks. `optimise { budget_chaos }` spends it as one total through the set planner.

Found on the way: logged out, pathofexile.com refuses every weighted search ("Query is too complex", even 2 stats), which
broke `plan_upgrades` for players without a POESESSID. Logged out it now uses a count search ("2 of the 8 stats worth
most", cheapest first) and the resist search a count group; PoB simulates every listing as before.

Tests: `tests/economy.test.mjs` (12, offline: fake poe.ninja and trade site, headless fixture). Real check (few polite
requests): planner and prices work on Standard; Covens returned no listings at the time.

Loose ends / ideas:
- Rares are not auto-priced (would need a pseudo-stat search per item); the AI Advisor card with a set plan is not
  checked in a window yet; guide uniques above the budget stay in `guide { next: true }`.

---

## Stage 6 — Crafting helper ✅ (2026-11-14)

### Features
- **Target item** from: guide item, Optimiser suggestion, or "a ring with life, 2 res, crit multi".
- **Mod knowledge**: PoB's mod data + tiers (`find_affix_tiers`, `list_craftable_mods` exist) + poedb.
- **Methods ranked by expected cost and risk**: alteration/regal, essences, fossils, Harvest, bench crafts,
  eldritch implicits, recombinators, metamods, influence — whichever applies this league.
- **Step-by-step plan** with probabilities and expected currency (simulate odds; poe.ninja prices),
  "stop and sell" points, and **buy-vs-craft** comparison (trade price of a finished item).
- **Bench crafts** for quick fixes (open prefix/suffix → resist/life), applied in PoB preview to show gain.
- SSF: only methods available from own drops; what to farm for the materials.

### Steps
1. Mod pool/tier model per base (PoB data), weights where known.
2. Method catalogue + expected-cost calculator.
3. Plan generator + buy-vs-craft; PoB simulation of the result.
4. MCP `craft_plan` + Overview/Items integration.

**Done when:** "craft me gloves like the guide" → ranked methods with steps, odds, expected cost, and the
finished item's simulated gain.

**Built (2026-11-14):** no new tool (99 tokens): `affixes { craft, base, ilvl }`. Engine in `agent-mcp/src/craft/`
(`target.ts`, `odds.ts`, `facts.ts`, `plan.ts`), PoB side `PathOfBuilding/src/Agent/Handlers/Craft.lua` (read-only).
1. ✅ Mod pool per base from PoB's data: every rollable prefix/suffix with its spawn weight on that base
   (`ItemClass:GetModSpawnWeight`), tier over all item levels, item level filter; essences, bench crafts and eldritch
   implicits for the item class; influenced pools (`influence`).
2. ✅ Methods: Alteration (+ Augmentation) → Regal (→ bench), Chaos Orb, the two best Essences for a want; seeded
   simulation of rolls (one mod per group, 3 prefixes + 3 suffixes, 4/5/6 mods at 8:3:1) with the bench filling the
   last want when a slot is open; expected cost at poe.ninja prices (currency and Essence pages), risk, stop points
   (tries for 50% / 90%, and what the profile currency covers). Fossils, Harvest, meta-crafting (3.30 costs),
   Recombinator and eldritch implicits are listed with cited text but no odds (weights not in our data).
3. ✅ Target from words ("life, 2 res, crit multi", "life 70+", "T1 life"), from an item (`craft: "item"` + item_text:
   a guide item or an optimiser pick, each mod at its tier or better) or for Stage 11 / Stage 5 from code
   (`craftPlan()` returns the best method and the buy price). Buy vs craft: one instant-buyout search with every want
   (2 trade requests), fair price via the Stage 5 price sanity, the cheapest listing simulated. The finished item is
   built by PoB's own crafter (average rolls) and simulated in the slot (`test_items`).
4. ✅ `craft: "fix"`: every bench craft that fits an open prefix/suffix of the slot's item, simulated and ranked.
   Stage 5 hooks (SSF / mixed) now name `affixes { craft: "<stats PoB found>", slot }`.

Facts: every crafting rule the odds use is quoted with source, link, version and read date in `src/craft/facts.ts`
(poewiki Modifier, Crafting, Rarity, Regal Orb, Essence, Crafting Bench pages; GGG 3.30 patch notes). Unknown and
shown as such: how often an Alteration gives 1 or 2 mods (cost range), whether 8:3:1 holds for Chaos/Essence rolls
(range 4 mods to 6 mods shown), fossil and Harvest weights, bench costs, roll spread inside a tier (taken as even).

Tests: `tests/craft.test.mjs` (9, offline: fake poe.ninja and trade site, headless fixture).

Loose ends / ideas:
- Overview/Items card for craft plans (step 4 of the plan) is not built: plans are text only for now.
- Not modelled: Exalted Orb slams, Harvest reforges, fossils, Veiled Chaos, Awakener's Orb, the bench's 3/8-chaos
  rerolls, multi-craft ("Can have up to 3 crafted modifiers"), weapons' local mods in the buy check (no category).
- Re-check `facts.ts` each league (the Alteration, Transmutation, Rarity pages were older than 3.30 when read).

---

## Stage 7 — Levelling coach 🔨 (2026-11-14: engine, data, card and tests done; AI tool waits for the budget cleanup)

### Features
- **Act-by-act plan** (from guide leveling spec or generated): passives per level range, gems to take from
  quest rewards / vendors per act and class, skill swaps (when to change main skill), support links per level.
- **Gear checkpoints**: resist targets per act (penalties after Act 5 and Act 10), movement speed boots,
  links (3L/4L), weapon upgrades; cheap league-start purchases or SSF vendor recipes.
- **Milestones**: labs (when to do Normal/Cruel/Merciless/Eternal and which ascendancy nodes), bandit,
  Pantheon unlocks, quest passive points not to miss.
- **Live tracking**: with character sync, "you're level 34 in Act 4 — next: …".
- **Overview Levelling card** while level < 90.

### Steps
1. ✅ Data: quest rewards/vendors per act & class (poewiki), lab/bandit/pantheon milestones.
2. ✅ Plan generator from guide leveling specs + PoB tree path ordering.
3. ✅ Checkpoint evaluator (resists after penalties, links, DPS sanity).
4. 🔨 Card ✅ + MCP tool (waits for the tool budget cleanup; about 350 tokens of tool definitions and 50 of guide text).

Built:
- **Data** (`PathOfBuilding/src/Agent/LevellingData.lua`, 90 KB, loaded only when used), generated by
  `agent-mcp/scripts/levelling-data.mjs` through the Stage 9 polite fetcher (robots.txt obeyed: no `limit=`, pages of 50
  with `offset=`; 2 s between requests; about 50 requests, cached a week): poewiki's Cargo tables `quest_rewards`,
  `vendor_rewards` (only the rows that make a gem available earlier for some class) and `areas` (campaign area levels per
  act); short facts from the pages Passive skill, The Lord's Labyrinth, Trial of Ascendancy, Deal with the Bandits, The
  Pantheon (+ each god's page for its act), Resistance, Item socket and Vendor recipe system. Each text fact keeps its
  source and a short quote; the script stops when a quote is no longer on its page. Pages edited before the live version's
  release are flagged "may be outdated". GGG's 3.30.0 patch notes were searched (quest, Labyrinth, campaign, Pantheon,
  vendor, penalty): no change to these facts. Checked: 23 Book of Skill quests in the table = "23-24 total" on the page.
  **Each league:** re-run `npm run build && node scripts/levelling-data.mjs` in `agent-mcp` (Stage 13 checklist).
- **Engine** (`Agent/Handlers/Levelling.lua`, loaded by Core.lua): `levelling_guide_stages` (a guide build's stages by
  points, each with its new notables in walking order from the previous stage, placed on levels by "level - 1 + quest points
  of the acts before", stage level from its title "Act 1-3" / "Level 30" or its points, main skill = biggest link group,
  ascendancy nodes in order), `levelling_plan` (act by act: quest points, lab trials, passives, gems with "Act N quest
  reward: Q" or "buy from NPC after Q" for the class, placed no earlier than the gem's level, swaps, links; milestones: labs
  done = ascendancy points / 2, the next lab's two nodes from the guide, bandit options simulated with what_if, Pantheon gods
  with major/minor from PoB's data; quest points expected vs allocated; checkpoints: resistances now and after the next
  penalty from PoB's uncapped totals, main skill links vs the plan, boots movement speed, weapon recipes for the skill's
  kind), `levelling_next` (no simulations). The act is PoB's own estimate (`build.Act`, Build.lua EstimatePlayerProgress).
  Plans without a guide use the open build as the target.
- **AI side** (`agent-mcp/src/levelling.ts`): reads the guide picked for the build (guide mode's state.json) in the side
  engine, formats the short answer and the full plan with sources; `character_sync` adds
  "LEVELLING: level N in Act X - next: ..." below level 90 (live tracking).
- **Overview Levelling card** (`Agent/LevellingCard.lua`): level and act, resistances after the next penalty (red when
  short), 5 next steps with tooltips (source, numbers from PoB); follows the guide picked in the Guide tab; recomputed only
  when the build changes, at most every 2 s; hidden from level 90.
- Tests: `agent-mcp/tests/levelling.test.mjs` (11: data file, guide stages, plan on a level-34 copy of the fixture, gems
  for the Witch, labs/bandit/Pantheon, resist maths = PoB with the penalty switched on, build unchanged, a synthetic guide
  with a skill swap and lab nodes, texts, the card headless via `tests/levellingcard.lua`).

Choices made while the player was away (can be changed):
- The act comes from PoB's estimate (passive points), not the character's quest state (the public character API does not
  give it). With unspent points the act can show one act early.
- Small passives are counted per act, notables/keystones/jewel sockets are named.
- Lab nodes: the guide's ascendancy nodes in the order its stages add them, two per lab.
- Resist targets = the cap PoB computes; no "how much over cap" advice (not a fact we can cite).
- Trade-mode "cheap league-start buys" are left to `plan_upgrades` / Stage 5; the coach lists SSF-friendly vendor recipes.
- No DPS judgement without a guide ("enough DPS" is not a cited fact); with a guide, `guide_compare` has the numbers.

Loose ends:
- [ ] MCP tool + guide text (after the budget cleanup); then this stage is finished.
- [ ] Check later (needs a window): the card's look in the Overview, tooltips, wide/narrow layouts.
- [ ] Transfigured and Vaal gems are not quest/vendor rewards: shown as "not a campaign reward" (check the wiki).
- [ ] Pantheon upgrades (Divine Vessels) changed in 3.30; only unlocks are covered here.

**Done when:** a level-1 character following a guide gets a complete act-by-act plan and correct "next" steps.

---

## Stage 8 — Farming & money advisor ⬜

### Features
- **Build capability check**: what content the build can do safely (map tiers, mods to avoid, bosses,
  Simulacrum, Delirium levels) from max hits, EHP, DPS vs content HP.
- **Strategies**: atlas strategies (Expedition, Harvest, Essence, Breach, Legion, Scarab mixes…) with
  atlas tree presets (feeds the Atlas tab), scarab/map device setup, required investment, expected profit
  per hour from poe.ninja prices (estimates, clearly labelled).
- **Progression path**: from white maps → voidstones → T16/T17 maps with what to do at each stage.
- **Money plan**: combine farming profit with upgrade plan ("farm 2 hours of X to afford Y").
- SSF variant: farm for specific items/materials.

### Steps
1. Capability model (content thresholds table, maintained in data file).
2. Strategy catalogue (data file per league) + atlas presets + poe.ninja pricing.
3. Profit estimator + progression path.
4. MCP `farming_plan` + Atlas tab "Strategy presets" + Overview card.

**Done when:** "how should I make currency?" gives 2–3 strategies the build can actually run, with atlas
setup, investment and estimated profit.

---

## Stage 9 — PoE knowledge engine (accurate, current, cited) ✅ (2026-11-13, released in 0.6.0)

**Goal:** the AI "understands PoE in and out" **without guessing**. Every factual claim comes from a
current, named source; if no source supports it, the AI says it doesn't know (and how to find out).

### 9.1 Accuracy rules (enforced by tools and the AI guide)
1. **No source, no claim.** Tools return facts with `source`, `url`, `game_version`, `retrieved_at`;
   the AI must cite them. Answers without a supporting source are marked "unverified" or not given.
2. **Version-aware.** Every fact is tagged with the game version/league it applies to (e.g. 3.30).
   Facts from an older version are flagged "may be outdated" and re-checked against newer sources.
3. **Source hierarchy** (higher wins when sources disagree):
   1. **Game data** extracted from the player's installed game files (current patch) and GGG's official
      exports (passive/atlas tree repos);
   2. **Official GGG**: patch notes, announcements, official trade API data endpoints
      (`/api/trade/data/items`, `/stats`, `/static`), pathofexile.com;
   3. **PoB's data** (maintained from game data; may lag a patch — check its version);
   4. **poedb** (datamined, fast to update; unofficial);
   5. **poewiki** (community-written; great explanations, can lag or be wrong after patches).
   Disagreements are shown to the player ("wiki says X, game data says Y — game data is newer").
4. **Numbers come from PoB simulations** of the player's build, never from memory or wiki examples.
5. **Freshness checks**: when a new patch/league is detected (game version, GGG patch notes, PoB/atlas
   update), cached facts for affected topics are marked stale and refreshed before use.
6. **Model knowledge is not a source.** The AI's training data may be outdated (and may mix in PoE2);
   it can only be used to decide *what to look up*, never as the answer.
7. **PoE1 vs PoE2 separation.** Every source/tool is tagged with the game; PoE2 facts are only used for
   comparisons in Teach mode, clearly labelled.

### 9.2 Knowledge sources (connectors)
- **Game files (most authoritative):** PoB's own exporter (`src/Export`) can read the installed game's
  data (needs the PoE1 install path) → current mods, bases, gems, uniques, stat descriptions, quests,
  areas. Build a local, versioned dataset per game patch. (Read-only; no game-client interaction.)
- **GGG official:** patch notes (forum + pathofexile.com announcements, parsed per patch), passive and
  atlas tree exports (already used), official trade data endpoints (item bases, stat ids — exact names).
- **poewiki.net:** MediaWiki API (search, pages, revisions with timestamps) + **Cargo tables** (structured
  items, gems, mods, quests, areas, versions). Track each page's last edit and the version it documents.
- **poedb.tw (PoE1 section):** mods/tiers/weights, base items, league mechanics, datamined text.
  No official API → gentle requests, heavy caching, parser tests so breakage is detected, not silent.
- **PoB data:** uniques, gem data, mod parsing (what PoB can/can't simulate — "not supported" lines).
- **poe.ninja:** current prices, popular builds/items (economy facts, timestamped).
- **Player's own data:** build files, character sync (Stage 2), profile.

### 9.3 Local knowledge base
- On-disk store (e.g. SQLite with full-text search) under `AgentCache/knowledge/`:
  entities (items, gems, mods, nodes, mechanics, areas, bosses), documents (wiki pages, patch notes),
  each row with source, url, game version, retrieved/edited timestamps, content hash.
- **Entity linking:** the same thing across sources ("Hyrri's Ire" in game data ↔ wiki ↔ poedb ↔ PoB ↔ trade).
- **Change tracking:** diff between patches ("what changed in 3.30 for Lightning Arrow / my items / my tree").
- Polite fetching: rate limits per site, User-Agent identifying the tool, caching, offline mode.

### 9.4 Tools (pob-mcp)
- `kb_search(query, type?)` → ranked entities/documents with sources and versions.
- `kb_entity(name|id)` → merged view of one thing (item/gem/mod/mechanic) with per-source facts,
  conflicts highlighted, freshness, and what PoB simulates.
- `kb_mechanic(topic)` → explanation of a mechanic (e.g. "more vs increased", "Harvest", "Spell Suppression")
  assembled from cited sources, at the player's explanation level.
- `kb_patch_changes(version?, filter?)` → patch-note changes, optionally only those affecting the
  player's build (skills, items, nodes in use).
- `kb_verify(claim)` → checks a statement against sources: supported / contradicted / not found.
- `kb_compare_games(topic)` → PoE1 vs PoE2 comparison (Teach mode), both sides cited.
- `kb_refresh(scope)` → refresh stale data (respecting rate limits).

### 9.5 AI behaviour (agentGuide + AGENTS.md)
- Look things up before answering factual questions; cite sources in the answer.
- Quote exact numbers and wording from sources; don't paraphrase numbers.
- Say "I couldn't find a reliable source for that" instead of guessing; suggest how to check.
- Check build-specific claims with PoB (e.g. "this unique is good for you" → simulate it).
- Mention the game version a fact is from, and flag anything older than the current patch.

### 9.6 Quality assurance
- **Evaluation set:** 100+ PoE1 questions with verified answers and sources (mechanics, items, gems,
  league mechanics, recent patch changes, PoE1-vs-PoE2 traps). Run on every change; track accuracy and
  "unsupported claim" rate.
- **Parser tests** for each connector (detect site changes).
- **Patch drill:** after a new patch, re-run the evaluation and refresh stale entities.
- **Logging:** which sources each answer used (local log) to audit mistakes.

### Steps
- [x] 1. Source hierarchy, fact schema and store; accuracy rules in the agent guide and AGENTS.md.
  Every fact has `source`, `url`, `game`, `game_version`, `retrieved_at` (`agent-mcp/src/knowledge/types.ts`);
  a fact that cannot be cited is never printed. The store is the page cache under `AgentCache/knowledge/http`
  (one JSON file per page with URL, time and the game version it was read under) plus `answers.log`
  (which sources each answer used).
- [x] 2. GGG official: the patch-notes forum (thread list and the staff post of each thread; player replies
  are never read) and the live version from it. **Not used:** the trade data endpoints, because
  pathofexile.com's robots.txt disallows `/api/` for automated clients and the knowledge engine obeys
  robots.txt (the trade tools keep using the trade API inside GGG's published rate limits, as before).
- [x] 3. poewiki (and poe2wiki for labelled comparisons): MediaWiki API with the page's last-edit time, and
  the Cargo `versions` table (release dates), so each passage is tagged with the version that was live when
  the page was last edited.
- [x] 4. poedb: item box and "Version history" of a page, with parser tests on a fixture and a live drill.
- [x] 5. Game files, **partly**: the installed client is detected read-only (Steam or standalone; build and
  last patch time) and used as the freshness signal: patched after our data was read means the version is
  re-checked. **Not done:** reading the game's data tables. PoB's exporter needs the Oodle extractor
  (`bun_extract_file.exe`), which PoB does not ship; we do not download executables. Until the player
  installs it, the top tier for data is PoB's own export of the game files (`src/Data`).
- [x] 6. Conflicts and freshness. PoB and poedb mod lines of a unique are compared and differences reported;
  wiki pages edited before the current league are flagged "may be outdated"; official patch notes that name
  the topic are listed first; cached pages are re-read after a patch (the cache is tied to the game version).
  Entity linking is by exact name across PoB, poedb, the wiki and the patch notes (no id table yet).
- [x] 7. Tools, two instead of seven to keep the tool definitions small (about 350 tokens):
  `kb_lookup { query, claim?, source?, refresh? }` covers search, entity, mechanic, verify, PoE2 comparison
  and refresh; `kb_patch { version?, filter?, build? }` covers patch changes and "for my build".
- [x] 8. Evaluation set: `agent-mcp/tests/knowledge-eval.json`, 121 questions (mechanics, items, gems,
  3.30 patch changes, PoE1-vs-PoE2 traps, claim checks, unknown things). `npm run test:kb` runs it against
  the live sources together with a parser drill and a check of every glossary quote.
  Result on 2026-11-13 (3.30.0): 121/121, 100 glossary quotes confirmed, 0 uncited facts.
- [x] 9. Glossary (62 PoE1 terms, 38 with a PoE2 comparison; each with a short quoted source) and the
  "what changed for my build" report (`kb_patch { build: true }`).

**Done when:** factual answers always carry current sources and versions; the evaluation set passes at
a high accuracy with zero uncited claims; disagreements and outdated facts are flagged; "what changed in
3.30 for my build" is accurate and sourced. **Met on 2026-11-13.**

### Loose ends and ideas (Stage 9)
- [ ] Game data tables (mods, bases, quest rewards) from the installed game: needs the Oodle extractor
  next to PoB's exporter (`PathOfBuilding/src/Export/ggpk`); then `src/Export` can build a per-patch dataset.
- [ ] After each new league: run `npm run test:kb`, fix what it reports, and move the glossary's `V1` /
  `CHECKED` forward (entries checked for an older league are flagged in every answer until then).
- [ ] `kb_lookup` claim check is a word-and-number match with the evidence shown; it does not understand
  negation ("cannot" vs "can"). The AI must read the quoted sentence.
- [ ] The wiki's own search ranks poorly for free text ("resistance cap"); the engine tries exact titles
  and single words first. Topics that are neither a page title nor a glossary term can miss.
- [ ] poedb's "Version history" lists every line that contains the name, so a short name ("Grace") also
  shows lines about other things ("Kalisa's Grace").
- [ ] Only uniques and gems are read from PoB's data; passives come from `tree_search`, mods from `affixes`.
- [ ] poe.ninja as an economy source is covered by the trade tools (`currency`, `price_check`), not by the
  knowledge engine.
- [ ] An SQLite store with full-text search over everything read so far, and a diff between two patches
  ("what changed for Lightning Arrow since 3.28") beyond what the patch notes and poedb's history give.
- [ ] Stage 10's in-PoB chat should show the citations as links.

---

## Stage 10 — AI chat inside PoB ✅ (2026-11-13, released in 0.8.0)

**Why:** ask questions without leaving PoB; the chat sees the open build and drives the tools.

### Backends (player chooses in Options; use subscriptions, no key needed)
- **Claude Code CLI**: `claude -p "<msg>" --output-format stream-json --mcp-config <pob.json>`
  (uses the player's Claude login); continue conversations with `--resume <session>`.
- **Codex CLI**: `codex exec --json "<msg>"` with the pob MCP server from `~/.codex/config.toml`;
  `codex exec resume` for continuity.
- **Anthropic API key** (optional): direct Messages API with tool use routed to pob-mcp; key stored like
  POESESSID, never printed.
(Antigravity has no headless CLI we rely on; it stays an external client.)

### Features
- Chat panel (dockable side panel in Agent Edition): streaming replies, markdown-ish rendering, item/
  node/gem links that highlight in PoB, "apply suggestion" buttons (preview first).
- Context: open build, profile, guide, explanation mode passed automatically.
- Conversation history per build; quick prompts ("why am I dying?", "next upgrade", "explain this node").
- Runs the CLI in a background sub-script (`io.popen` / process pipes), parses JSON lines, cancel button.
- Safety: same tools and rules as external clients; no game-client access.

### Steps
1. ✅ Spike: `claude -p` and `codex exec` run from PoB without a console window (LuaJIT FFI pipes + job object,
   `Agent/ChatProcess.lua`); a Node bridge (`agent-mcp/src/chat/`) parses their JSON into one event format.
2. ✅ Chat UI panel (`Agent/ChatPanel.lua`): docked right, hideable (edge tab), streaming text, **bold**/lists,
   `[[node/item/gem:...]]` links (hover tooltip, click highlights), `[[apply:...]]` Preview/Apply cards, quick prompts, Stop.
3. ✅ Sessions per build and backend (`AgentCache/chat/builds/`), context injection (build, view, profile, guide,
   edit toggle), backend picker + Sign in in Options, "AI may edit" toggle in the panel (off by default).
4. ✅ Optional API-key backend: official `@anthropic-ai/sdk`, tool use routed to agent-mcp over MCP stdio, history in
   `AgentCache/chat/api/`. Key in AgentEdition.json (`anthropicApiKey`), read by the bridge only, never shown.

**Tested (2026-11-13):** `npm test` 86/86 (9 chat tests: parsers, edit-tool policy, fake Claude/Codex CLIs, fake
Anthropic API with real MCP tool routing, LuaJIT process runner). Live on a test window (port 31345): "why am I weak
at bosses?" through **Codex** streamed an answer that used profile_get, diagnose, build_summary, what_if, kb_lookup on
the open build, with a gem link and an apply card whose Preview matched PoB's what_if (13.28m -> 9.28m DPS).
The same question through **Claude Code** (desktop app's CLI, signed in once) streamed an answer using diagnose,
optimise, what_if, build_summary, stats, with node and gem links and two apply cards.

**Models:** a model per backend in Options, default the balanced one (Claude Code `sonnet`, Codex `gpt-6.1-sol` with
low reasoning effort, API `claude-sonnet-5-5`); cheaper and strongest choices are opt-in. Defaults live in `Chat.MODELS`
(Lua) and `DEFAULT_MODELS` (backends.ts); update both when the vendors rename models.

### Loose ends (Stage 10)
- Codex sends whole messages, not token deltas (`codex exec --json` has no partial output): its text arrives per message.
- The panel's input is one line (Enter sends); a multi-line box could come with Stage 12 (UI polish).
- Claude Code needs a one-time `claude auth login` even when the Claude desktop app is signed in (Options > Sign in).

**Done when:** typing "why am I weak at bosses?" in PoB streams an answer from Claude Code or Codex
that used the pob tools on the open build.

---

## Stage 11 — Create a build ⬜

**Why:** the player wants to find or design a build that fits how they like to play, including new builds that a
patch makes possible and ideas nobody plays yet. It must stay honest about what is proven, what is theorycraft and
what things really cost.

### Features
- **Preference interview (first step):** before suggesting anything, ask a short set of questions and save the
  answers in the player profile (shared by every AI app):
  - playstyle: melee, ranged, spells, minions, totems/traps/mines, DoT vs hits; fast clear vs boss killer;
    tanky vs glass cannon;
  - feel: how many buttons, big slow hits vs fast small ones, "something new" vs "proven";
  - practical: budget, league start or mid-league, trade/SSF/mixed, Hardcore, time per week;
  - exclusions: skills, ascendancies or mechanics the player doesn't want.
  Answers can be changed later; every suggestion says which preferences it matches.
- **Discover:** poe.ninja build data for the league → popular skills/ascendancies, cost tiers, difficulty,
  league-start friendliness; filtered by the interview answers.
- **From a guide:** Stage 3 import with stages and the levelling plan (Stage 7).
- **From a popular character:** import a top character, then make a cheaper/staged version (Optimiser +
  Economy swap expensive items for affordable ones, keeping key mechanics).
- **Adapt** a known build (e.g. "make it tankier", "SSF version").
- **Theorycraft mode (experimental, clearly labelled):** new and unique builds from the data we have.
  - *Patch opportunities:* the knowledge engine (`kb_patch`, Stage 9) lists what a patch changed (buffed skills
    and supports, new or changed uniques and gems, mechanic changes, ascendancy changes), each with its citation,
    and checks which of them few players use yet (poe.ninja usage).
  - *Original ideas:* the player (or the AI) picks core pieces (a skill, key uniques, an ascendancy, a mechanic
    such as "life to ES conversion with low life"), or asks "what synergies does this new unique enable?".
  - *Build it from data, not guesses:* start from the nearest real build using the same skill or mechanic as a
    template where one exists; then the Optimiser (Stage 4) searches the tree, supports, auras, flasks and gear,
    simulating every step in PoB. Several candidate setups are compared on DPS, EHP, weakest max hit and cost.
  - *Honesty:* every theorycraft build is marked "theorycraft, not tested by players". If PoB doesn't model a
    new mechanic yet (or a stat isn't supported), it says so instead of showing numbers that leave it out.
    Facts about mechanics come from `kb_lookup`, numbers only from PoB.
- **Current prices:** every item, gem and unique in a suggestion shows today's price (poe.ninja for uniques,
  gems and currency; instant-buyout trade listings for rares), with the league and the time it was checked. Each
  build shows a total cost per stage (league start, early maps, endgame), and prices are refreshed on request.
- **"Close enough" items instead of exact ones:** exact rares and crafted items are almost never for sale, so
  each rare in a build becomes a *target*:
  - the stats that matter for this build, ranked by how much each one is worth (simulated in PoB), with "must
    have" and "nice to have" and acceptable ranges (e.g. 70+ life, 2 resists, any open suffix);
  - a weighted instant-buyout trade search for items that meet the must-haves, each result simulated in the
    build and ranked by gain per chaos against the target ("92% of the target for 15c");
  - for items that are crafted in the guide or build: a "craft it" option (Stage 6) with steps and expected cost,
    shown next to "buy the closest", and in SSF only the craft and farm options;
  - uniques with variable rolls get a "good enough roll" range instead of perfect rolls.
- **Output:** a PoB build with a tree, gems and item sets per stage and per budget, notes explaining how it works
  and why each choice was made, prices with their date, and the targets for every rare.

### Steps
1. Preference interview + profile fields (shared schema in `Settings.lua` / `profile.ts`).
2. poe.ninja builds data client (league, skill, ascendancy, items, cost) + recommendation with the filters.
3. Character→build import + "budget version" generator (with Stages 4 and 5).
4. Price layer: poe.ninja + instant-buyout trade, cached with time and league; cost per stage.
5. Item targets: stat weights from PoB simulation, must-have/nice-to-have ranges, weighted trade search with
   per-result simulation, "craft it" hook (Stage 6), roll ranges for uniques.
6. Theorycraft mode: patch-opportunity finder (Stage 9), template matching, Optimiser search, candidate
   comparison, "not modelled by PoB" detection and labels.
7. MCP tools (inside the 5,000-token budget; merge where possible) + an Overview start screen when no build
   is open.

**Done when:**
- "cheap bow league starter" → the interview → 3 options with cost and difficulty → one opened as a staged build
  with today's prices;
- every rare has a target, and the trade search finds close items with their simulated gain;
- "what's new in 3.30 for minions?" → cited patch opportunities → a theorycraft build marked as such, with PoB
  numbers and any unmodelled parts named.

---

## Stage 12 — UI polish ⬜
1. Inventory: sockets/links on items, item level/quality badges, empty-socket warnings.
2. Restyle Tree / Items / Skills / Calcs tabs and popups (Options is still grey).
3. Advisor with tabs (Items / Passives / Gems / Other) and "apply in preview".
4. Charts: DPS/EHP history (Stage 2), scaling report (Stage 4).
5. Fixes from real-mouse testing; accessibility (font size, contrast).

## Stage 13 — Data freshness ✅ (2026-11-13, released in 0.7.0)
1. ✅ 3.30 **uniques** preview from PoB PR #10438: one `PathOfBuilding` commit "Preview: 3.30 uniques from
   PoB PR #10438" (Steelworm, Malachai's Loop, Shavronne's Wrappings, The Hallowed Monarch, Shadowstitch,
   Rotmother's Mutiny; Steelworm's 8-shard wording now parses). The PR is based on PoB's `dev`, so only its own
   lines were taken onto 2.67.2 (ModCache: only the lines it adds or removes); `src/Export/Uniques` (exporter
   input, not loaded by PoB) was left out. Its files all exist in 2.67.2 already, so the marker names text:
   `[upstream-preview: src/Data/Uniques/body.lua contains "Pre 3.30.0"]`; `update-pob.ps1` now understands
   `<path> contains "<text>"` as well as a bare `<path>`.
2. ✅ Checked 2026-11-13: newest official PoB is still **v2.67.2** (our base), PRs #10437 (trees) and #10438
   (uniques) are open, so both previews stay. No rebase was needed. (#10437 has one more commit since ours,
   "Satisfy cspell", a spelling-list change only.)
3. ✅ Atlas: GGG's export is unchanged ("3.30.0 preview 2", 2026-11-12), the one in `TreeData/Atlas/3_30`.
4. ✅ Checklist below.

### Each league: data review checklist
Run at league launch and again after the first big patch (PoB usually ships the league's data within days).
1. `tools\update-pob.ps1 -Check`: newer official PoB? It also runs the atlas check. If yes, message the
   repo-control session first (the update rebases `agent`), then run it: previews whose path or text the release
   has are dropped, the rest are kept and listed.
2. If PoB has no release yet: look for open PoB PRs with the new tree or uniques (`gh pr list -R
   PathOfBuildingCommunity/PathOfBuilding -S "3.NN"`) and take them as `[upstream-preview: ...]` commits (one per
   PR, only the PR's own lines, credited by name). Never extract game files ourselves (GGG's terms).
3. `tools\update-atlas.ps1 -Check`, then without `-Check` if GGG published new atlas data; restart PoB.
4. Knowledge (Stage 9): `npm run test:kb` in agent-mcp (patch notes for the new version, glossary quotes still on
   their pages); fix glossary entries the league changed.
5. League data of Stages 7/8 (strategies, thresholds), once they exist: read the league's patch notes
   (`kb_patch`) and update or flag every entry the league changed.
6. Smoke test: open a build of each common archetype in PoB, `diagnose`, and compare a few numbers with the
   previous release; `npm test` in agent-mcp.
7. Add a CHANGELOG line ("Data: 3.NN trees / uniques / atlas") and the base version in the release notes.

## Stage 14 — PoE2 edition 💭
Same approach on PathOfBuilding-PoE2 (installed on this PC): fork, live API, second MCP server or a game
switch, PoE2 trade/atlas, shared profile and chat.

## Stage 15 — Install, portable version & updater ✅ (2026-11-13, released in 0.3.0)

**Why:** players install from a release zip, so they need to know when a new version is out and update
with one click, without losing builds or settings. Some players don't want an installer at all: they
want to unzip and play. PoB's own updater is off in Agent Edition (it runs in dev mode from our files) and
must stay off, or it would replace our fork with official PoB.
**Starts after the 0.2.0 release** (Stage 16 changes the installer and release script).

### Features
- **Portable version** (a second download next to the normal zip, `PoB-Agent-Edition-<ver>-win64-portable.zip`):
  - **Bundled Node.js:** the official Windows `node.exe` (LTS) in `node\`, with Node's MIT licence
    (`node\LICENSE`, row in THIRD_PARTY_NOTICES). Nothing to install; about 30 MB extra.
  - **`Start PoB Agent Edition.cmd`** in the top folder: one double-click runs PoB. No shortcuts, Start menu
    entries or registry changes.
  - **`Connect AI apps.cmd`** (optional): only adds the `pob` entry to Claude Desktop, Claude Code and Codex
    (the same code as `install.ps1`, without shortcuts), using `node
ode.exe`. Anyone who wants no
    scripts at all copies the entry from `mcp-config.txt`, which the start script writes with this folder's
    paths (MCP apps need absolute paths, so this is the one step no zip can skip). `Disconnect AI apps.cmd`
    removes it.
  - **Optional fully portable mode:** an empty `portable.txt` (or a choice in `Connect AI apps.cmd`) keeps
    builds and settings (`Builds\`, `AgentEdition.json`, icon cache) inside the folder instead of
    `Documents\Path of Building`, for USB sticks or players who want nothing outside the folder. PoB and
    agent-mcp both read the same switch. Default stays the Documents folder, so the normal PoB sees the builds.
  - Moving the folder just works: run `Connect AI apps.cmd` again to update the paths.
- **Update reminder (players):** on start, at most once a day, PoB Agent Edition checks the latest
  release of `urbanvcode/pob-agent-edition` on GitHub. If it is newer, the Overview shows a banner such as
  "v0.3.0 is available" with the changelog notes and the buttons **Update now**, **Later** and
  **Skip this version**. Options has a switch to turn checking off. Nothing is sent except the version request.
- **AI knows too:** `status` (or a small `update_check` tool) reports "update available x.y.z", and
  the agent guide says to mention it once per conversation, never nag.
- **One-click updater:** `tools/update.ps1` (started from the banner or by hand) detects the install type
  (installer zip, portable zip or git) and downloads the matching release zip over HTTPS. It checks the
  SHA256 against the release's `.sha256` file, waits for PoB to close, and keeps the current folder as a
  backup (`..\PoB Agent Edition.previous`). It then replaces the program files and keeps `node\` and the
  portable data, re-runs the AI connection quietly (installer or `Connect AI apps.cmd`, only if it was used
  before) and restarts PoB. It never touches `Documents\Path of Building` (builds, AgentEdition.json).
  **Roll back** restores the backup.
- **Updates straight from our GitHub repo:** zip installs update from the repo's GitHub Releases (the
  built zip, so no Node build step is needed). Git installs (`git clone --recurse-submodules`) are
  detected by the `.git` folder and update with `git pull` + `git submodule update --init` + `npm ci &&
  npm run build` in agent-mcp, then the same connect/restart. All three show the same banner and changelog.
- **Base freshness (developer):** the same check also reports when official PoB has a newer release
  than our base, or GGG has new atlas data (the logic of `update-pob.ps1 -Check` / `update-atlas.ps1 -Check`),
  as a reminder to make a new release.

### Steps
1. ✅ Version source of truth: a `VERSION` file at the root, read by PoB (window title, Options) and by
   agent-mcp; `build-release.ps1` checks it matches the CHANGELOG.
2. ✅ Portable build: `build-release.ps1` also makes the `-portable.zip`. It downloads the pinned Node LTS
   Windows zip from nodejs.org, checks it against nodejs.org's published SHASUMS256, and adds `node\`,
   the start, connect and disconnect scripts and Node's licence.
3. ✅ Portable data mode (`portable.txt`) in PoB (`Main.lua` user path) and agent-mcp (`paths.ts`), with a
   test that nothing is written outside the folder in that mode.
4. ✅ Release check in PoB (Lua, async `DownloadPage` of the GitHub releases API, daily cache in
   AgentEdition.json, semver compare, skip/snooze stored there).
5. ✅ Overview banner + Options switch + changelog popup.
6. ✅ `tools/update.ps1`: install-type detection, download, SHA256 verify, backup, swap, reconnect, restart,
   `-Rollback`; git mode (pull, submodules, rebuild). Manual update stays documented in the README.
7. ✅ `status`/`update_check` + agent-guide line (keep AGENTS.md and `agent-mcp/src/guide.ts` in sync).
8. ✅ README: "Download" table with both zips (installer: easiest; portable: unzip and play, no installer),
   plus the manual steps.
9. ✅ (simulated, see below) Test the full path on a clean Windows user account without Node installed:
   - portable zip: unzip, start, connect, AI works, move the folder and reconnect, portable data mode,
     disconnect, delete the folder (nothing left behind);
   - installer zip and git install: update from a test pre-release, roll back;
   - every time: builds and the POESESSID survive.

Built (2026-11-13, not released yet):
- `VERSION` at the root is read by PoB (`Agent/Update.lua`: window title, footer `v0.2.0 (PoB 2.67.2)`), agent-mcp (`paths.ts`, falls back to package.json) and `build-release.ps1` (refuses a mismatch, only warns about package.json). **Bump VERSION when releasing.**
- Portable zip: Node.js **v24.22.3** (LTS Krypton, pinned in `build-release.ps1`; Node 26 is LTS too but untested), `node/LICENSE` + `node/VERSION.txt`, `portable/*.cmd` copied to the zip root, `Install.cmd` left out. About 665 MB vs 631 MB.
- `install.ps1 -Portable` (bundled node, no shortcuts, asks about portable data mode) and `-Quiet` (used by the updater). In portable data mode the MCP entry has no `POB_DIRECTORY`; the server finds `UserData` through `portable.txt`.
- Update state under `update` in AgentEdition.json (`check`, `checkedAt`, `latest`, `url`, `notes`, `skip`, `snoozeUntil`, `base`). agent-mcp only reads it and refreshes into `AgentCache/update/latest.json`; `status` mentions a newer release once per server process. Tests set `POB_AGENT_UPDATE_CHECK=off`.
- `tools/update.ps1`: `-Check`, `-Version`, `-ZipFile` (offline or test builds), `-Rollback`, `-Restart`, `-Yes`. It re-runs itself from %TEMP% so it can replace itself, keeps `UserData`, `portable.txt`, `mcp-config.json`, PoB runtime settings and screenshots, and reconnects AI apps only if `mcp-config.json` exists. Git mode refuses a dirty tree and records the old HEAD in `.git/pob-agent-previous-head`.
- Tested here: unit + contract tests (33/33), the portable zip headless with the bundled node (nothing written to Documents), the portable PoB window (banner, Options switch, title and footer), the What's new popup and Update now flow with stubs, update from a zip + rollback on a test folder, `-Check`.
- Step 9, simulated clean PC (the player could not set up a second Windows account): PATH without Node.js or `claude`, a fake user profile (APPDATA, LOCALAPPDATA, USERPROFILE). Start script, Connect AI apps (Claude Desktop, Claude Code, Codex entries with the bundled node), portable data mode, moving the folder + reconnect, the AI server from the moved folder, Disconnect (all three entries removed, other keys kept) and nothing left outside the folder: all OK. It found and fixed two installer bugs: Windows PowerShell 5.1 broke `node -e` (Claude Code entry not written when there is no `claude` command, also in the normal installer), and an empty Start menu folder path stopped the installer.
- Still untested until there is a newer release than 0.3.0: an update from a real GitHub release, a git-install update, clicking the banner buttons in a real window.

**Done when:** a player without Node.js can unzip the portable version, play and connect their AI app
with no installer and nothing left outside the folder (in portable data mode). A player on an old zip
(installer or portable) sees the banner, clicks Update now, and is on the new version with builds,
settings and AI connections working; Roll back returns to the old one.
**Note:** the repo is public (2026-11-13), so the check needs no login. GitHub's `/releases/latest`
skips pre-releases (all 0.x releases are pre-releases), so read `/releases` and take the newest by version.

## Stage 16 — Own MCP server (replace pob-mcp) ✅ (2026-11-13, released in 0.2.0)

**Why:** pob-mcp (our fork of ianderse/pob-mcp) is about 27,000 lines of TypeScript, of which about
1,800 are ours. It was built headless-first, with the live window added later. Measured 2026-11-13:
**115 tools, about 16,000 tokens of tool definitions** loaded into the AI's context every conversation.
AGENTS.md and the stages rely on only about 20 of them. The PoB window's live API also loads its Lua
handlers from `pob-mcp/lua/`, so PoB itself depends on pob-mcp. A server of our own, designed around the
live window, the player profile and our rules, gives shorter and better answers and one codebase we fully
understand.
**Do it next** (build order: 16 → 15 → 2 ...), so Stages 2-11 add their tools to the new server rather
than to pob-mcp.

### Design
- **Where:** `agent-mcp/` in this repo (no submodule). TypeScript + the official MCP SDK on Node 20,
  the same as the installer sets up today. GPL-3.0 like the rest of the repo; porting pob-mcp code is
  allowed under its GPL-3.0.
- **Live first:** talks to the PoB Agent Edition window (`127.0.0.1:31337`). Headless fallback runs PoB
  with our own runner (`PathOfBuilding/src/Agent/Headless.lua`, Inflate fix built in) for saved build files.
- **Lua handlers move into the PoB fork** (`src/Agent/Handlers/`), used by both the live server and the
  headless runner. `POB_AGENT_LUA_DIR` and the dependency on `pob-mcp/lua/` go away.
- **About 30 focused tools** (merge where one call can do the job):
  - Session: `status`, `open_build`, `save_build` (always a new name unless asked), `set_view`,
    `open_options`, `list_builds`.
  - Profile: `profile_get`, `profile_set`, `profile_mark_learned`.
  - Read: `build_summary` (class, skills, gear, tree, config assumptions), `stats` (filtered),
    `diagnose` (resists → max hit → EHP → recovery/mana → damage, in AGENTS.md order, one call).
  - Edit and simulate: `edit_items`, `edit_skills`, `edit_tree`, `set_config`, `what_if` (apply
    changes, return before/after, roll back unless asked to keep), `snapshot` / `restore`, `compare`.
  - Trade: `leagues`, `trade_search` (instant buyout only), `plan_upgrades`, `price_check`.
    Port our rate governor and limits unchanged.
  - Atlas: `atlas_get`, `atlas_search`, `atlas_edit`.
  - Later stages add their own (character sync, guides, crafting, levelling, knowledge).
- **Output rules:** numbers first, compact text, every result names its config assumptions (boss,
  charges, flasks), and errors say what to do next. The agent guide is sent as server instructions (AGENTS.md
  stays the human copy).
- **Budget:** all tool definitions together ≤ 5,000 tokens (a test fails above it). Split per stage since
  2026-11-14: see "Budget note" below.
- **Credit to pob-mcp, always** (player's rule): our server grew out of [ianderse/pob-mcp](https://github.com/ianderse/pob-mcp),
  and it keeps that credit even after pob-mcp is removed, whether code was ported or only ideas were taken:
  - `agent-mcp/README.md` and the root README's "Credits" section: "Based on / inspired by pob-mcp by
    ianderse (GPL-3.0)" with the link.
  - `THIRD_PARTY_NOTICES.md` keeps a pob-mcp row (what was ported, its licence).
  - Every file that contains ported code keeps a header comment naming the original file in pob-mcp and
    its GPL-3.0 licence. GPL-3.0 requires keeping those copyright notices.
  - `agent-mcp/package.json` names pob-mcp in `description` or `contributors`.
  - The release notes for the switch say where it came from and thank the author.
  - Calculation and game-data credit stays with Path of Building Community (unchanged).

### Steps
1. ✅ Inventory and tool list agreed with the player: the 28 planned tools plus `tree_search`, `suggest_passives`,
   `anoint` and `affixes` (the player asked to keep anoints, passive/mastery suggestions and affix tiers). Then, to
   replace pob-mcp fully, the player chose seven more gaps to close: support gem advice, resist-fixing gear, boss
   readiness, currency rates, export code + notes, affix classification, jewel advice (`suggest_gems`,
   `suggest_jewels`, `currency`, plus options on `diagnose`, `plan_upgrades`, `save_build`, `build_summary`,
   `affixes`). 34 tools.
2. ✅ Lua handlers moved into `PathOfBuilding/src/Agent/Handlers/` (`Core.lua`, `Ops.lua` ported; `Tools.lua` new)
   and the headless runner `Agent/Headless.lua` (real Inflate built in). `POB_AGENT_LUA_DIR` is gone.
3. ✅ `agent-mcp` skeleton: connection (window checked on every call, headless fallback, second engine for
   `compare`), agent guide as server instructions, tool registry, token-budget test.
4. ✅ All tools ported or written, each with a headless contract test on a fixture build; live smoke test.
5. ✅ Parity checked against the AGENTS.md workflows on a second PoB window (port 31338). The `pob-legacy`
   side-by-side install was skipped: pob-mcp leaves in the same release, so there was nothing to keep it for.
6. ✅ `pob-mcp` submodule removed; installer, `build-release.ps1`, `check-secrets.ps1`, `update-pob.ps1`, README,
   THIRD_PARTY_NOTICES, AGENTS.md and docs updated; every "Credit to pob-mcp, always" item checked.
7. ⬜ Release 0.2.0 (repo-control session): changelog note tells players to rerun `Install.cmd`; credits pob-mcp.

Built:
- `agent-mcp/` (TypeScript, MCP SDK, Node 20; about 3,000 lines against pob-mcp's 27,000): 34 tools, about 3,600
  tokens of tool definitions (was about 16,000; `npm test` fails above 5,000). Files: `src/pob.ts` (connection),
  `src/tools/*.ts` (session, read, edit, advice, trade), `src/trade/*` (client, governor, upgrade planner),
  `src/profile.ts`, `src/guide.ts`.
- New in PoB (`Agent/Handlers/Tools.lua`): `summary`, `diagnose`, `stats`, `edit` (typed ops), `what_if` (applies
  ops, measures, rolls back with PoB's own undo states inside one frame, so the window never flickers),
  `tree_search`, `suggest_passives`, `anoint`, `affixes`, `config_search`; `restore_build_xml` in the live server.
- Every result names its config assumptions (enemy, charges, flasks). `save_build` refuses to overwrite without
  `overwrite: true`; `open_build` refuses to replace unsaved changes without `discard_unsaved: true`.
- Trade: governor and limits ported unchanged; instant buyout is now fixed in code (no env switch); league
  defaults to the profile, else the current challenge league; stat filters by text.
- Installer: one-line MCP entry (the server finds PoB next to itself). Claude Code is also set up when there is
  no `claude` command (the Claude desktop app's Claude Code): it edits `~/.claude.json` through Node.
- Fixed on the way (bugs in the ported pob-mcp code): flask on/off did not change the numbers until reload;
  picking a mastery re-imported the tree and dropped tattoos.
- Gap closing (all simulated in PoB, build restored exactly afterwards; `Agent/Handlers/Advice.lua`):
  - `suggest_gems`: value of each current support, every fitting support tried in place of the weakest (or as an
    extra link), gem levels capped by the character's level, under-levelled gems pointed out, playstyle-changing
    supports (mine, trap, totem, Barrage, triggers) listed apart.
  - `diagnose { boss }`: PoB's boss skill presets (Data/BossSkills) per boss, normal or uber: damage taken after
    defences, hits survived, verdict. No kill time: PoB has no boss life data, and the tool says so.
  - `plan_upgrades { focus: "resists" }`: weighted trade search on the resistances that are short, each listing
    simulated in the slot, ranked by resistance really fixed. Chaos waits until elemental is capped.
  - `suggest_jewels`: jewel, abyss, Watcher's Eye mods (best tier, top roll, one at a time against a blank jewel)
    and cluster notables.
  - `affixes { slot | item_text }`: prefix/suffix, tier of N, bench crafts, open slots; flags lines it cannot place
    and possible hybrids instead of guessing.
  - `currency` (poe.ninja rates, profile currency in chaos), `save_build { note, export_code }`,
    `build_summary { parts: ["notes"] }` (full notes).
- Tests: 32 pass (`npm test`: token budget, tool list, profile, governor, trade client limits, upgrade scoring,
  and contract tests for every non-trade tool headless). Live smoke test passes on port 31338, with real trade
  calls (`leagues`, `price_check`, `trade_search`, `plan_upgrades`). Codex CLI ran the full workflow
  (profile_get → status → diagnose → atlas_get → what_if) on the new server. Claude Code connected and listed
  all tools; a full headless conversation could not be run (the bundled CLI is not logged in outside the app).
  The gap-closing tools were also run live on port 31338, with real trade calls for the resist search and
  poe.ninja for `currency`.

Loose ends:
- [ ] Player: after 0.2.0 is out (or now, from this folder) run `Install.cmd`, restart Claude / Codex /
  Antigravity and PoB Agent Edition, then ask "check my build" once in Claude Code and once in Claude Desktop.
  Until then the AI apps still use the old `pob-mcp` folder, which stays on disk (ignored by git) and can be
  deleted afterwards.
- [ ] Antigravity is not set up by the installer (copy the `pob` entry from `mcp-config.json`).
- [ ] The contract fixture uses the 3.13 tree (no masteries); add a current-tree fixture that is not a
  player's build. Masteries were tested by hand on a 3.28 build.
- [ ] Not carried over from pob-mcp, by the player's choice: crafting advisor (Stage 6), levelling plan (Stage 7),
  budget build creation (Stage 11), watch mode (obsolete), currency arbitrage and config presets (dropped).
- [ ] `suggest_jewels` needs an allocated jewel socket (except for cluster notables). `suggest_gems` freezes the
  PoB window for a few seconds while it simulates about 100 supports.
- [ ] `open_build` takes PoB codes but does not fetch pobb.in / pastebin links (Stage 3).

### Budget note (2026-11-14): room for Stages 5-8 and 11
Every tool definition and the agent guide are loaded into the AI's context in every conversation. After Stages
2-4, 9 and 10 the server had 42 tools at about **4,744 of 5,000 tokens** and the guide at its **1,200-token**
cap, with five stages still to add tools. Freed (same features, same handlers):
- **Merged overlapping tools** into one name with a mode, routed to the original handlers (`routed()` in
  `agent-mcp/src/registry.ts`, list in `src/tools/index.ts`): `profile` (get / set / learned), `character`
  (sync / history), `edit` (items, skills, tree, config ops), `snapshot` (+ `restore: true`), `suggest`
  (`kind`: passives, anoint, gems, jewel kinds), `guide` (import / compare / next), `prices` (item price,
  currency rates, leagues), `atlas` (get / search / change), `set_view` (+ `OPTIONS`).
- **Old names still work** as hidden aliases (not in the tool list, so they cost nothing): `profile_get`,
  `profile_set`, `profile_mark_learned`, `open_options`, `character_sync`, `character_history`, `edit_items`,
  `edit_skills`, `edit_tree`, `restore`, `suggest_passives`, `anoint`, `suggest_gems`, `suggest_jewels`,
  `guide_import`, `guide_compare`, `guide_next_steps`, `leagues`, `currency`, `price_check`, `atlas_get`,
  `atlas_search`, `atlas_edit`.
- **Shorter descriptions and parameter docs**; defaults and examples that results already show were dropped.
- **Guide**: the play-mode, hardcore and explanation-mode rules live in `profile`'s "How to answer" (they were
  in both); details moved into tool descriptions and results.
- **Chat read-only mode** is now enforced by the server too (`POB_READ_ONLY=1` when "AI may edit" is off):
  merged tools have reading and writing modes, so hiding tool names alone was not enough. `what_if { keep }`
  is now refused there as well (it was a gap).

| | Before | After |
|---|---|---|
| Tools | 42 | 26 |
| Tool definitions (chars / 4) | 4,744 | 3,056 (test cap 3,100) |
| Agent guide | 1,200 (cap 1,200) | 676 (cap 950) |

**Allocation for the remaining stages** (tool definitions; guide text about 50 tokens each):

| Stage | Tools | Guide |
|---|---|---|
| 5 Economy | 400 | 50 |
| 6 Crafting | 350 | 50 |
| 7 Levelling | 350 | 50 |
| 8 Farming | 350 | 50 |
| 11 Create a build | 450 | 50 |
| **Total** | 3,100 + 1,900 = **5,000** | 676 + 250 = about 926 (cap 950) |

Each stage raises `TOOL_BUDGET` in `agent-mcp/tests/unit.test.mjs` by its own share only (and `GUIDE_BUDGET` stays
950). Prefer a new mode on an existing tool (`prices`, `suggest`, `guide`, `character`) over a new name.

**Done when:** every AGENTS.md workflow (profile, diagnose, plan_upgrades, atlas, save as new file) works
on the new server in Claude Code, Claude Desktop and Codex; tool definitions ≤ 5,000 tokens; the PoB
window no longer reads anything from `pob-mcp/`; the submodule is gone and a release is published;
pob-mcp is credited in the README, THIRD_PARTY_NOTICES, `agent-mcp/README.md`, the ported files' headers
and the release notes.

## Stage 17 — Lighter: smaller downloads and updates, less memory, disk and CPU ✅ (2026-11-13, released in 0.8.0)

**Why:** each release zip is about 630 MB (the portable one about 665 MB), and every update downloads the whole zip
again, although most updates change only a few MB of our own code. Unpacked, almost all of it is Path of Building's
own data (measured on 0.3.0):

| Part | Unpacked | What it is |
|---|---|---|
| `PathOfBuilding/src/TreeData` | 583 MB | 43 passive tree versions with their images; about 309 MB are Ruthless and "alternate" variants |
| `PathOfBuilding/src/Data` | 205 MB | 170 MB of it is the timeless jewel lookup tables |
| `PathOfBuilding/runtime` | 28 MB | the PoB program |
| `agent-mcp` | 26 MB | our MCP server with its Node packages |
| `node\` (portable only) | about 33 MB | bundled Node.js |

The player also wants the running app to be efficient, using little memory (RAM), disk space and CPU while it runs
next to the game.

### Features
- **Measure first** (`tools/measure.ps1`, with the results kept in this section). It measures:
  - download sizes and the unpacked size per folder;
  - RAM of the PoB window (idle, with a big build, after an hour), of the agent-mcp server and of the headless engine;
  - CPU of an idle, unfocused PoB window (the live server keeps frames running; about 7% of a core was measured
    in Stage 0);
  - disk used by caches and history in `Documents\Path of Building` after a week of use.
  Every change below reports before/after numbers from this script.
- **Smaller updates (the biggest win):** every release publishes a file manifest (path, size, SHA256). The updater
  compares it with the installed files and downloads only what changed, as a small delta zip per release (for
  example `update-0.4.0-to-0.5.0.zip`), checked file by file against the manifest. It falls back to the full zip if
  anything doesn't match. Target: an update that changes only our code is under 50 MB.
- **Optional data packs:** the Ruthless tree variants (PoE1's harder, low-drop mode) and very old tree versions
  move out of the main zip. When a build needs a tree that isn't installed, PoB says so and downloads just that
  tree folder from our fork's release tag on GitHub (HTTPS, checked against the manifest). Offline, it shows a
  clear message instead of failing. The default zip keeps the current and recent trees.
- **Memory (RAM):**
  - PoB window: find what stays in memory (all tree versions loaded? icon cache, images, history, timeless jewel
    tables), load lazily or free what isn't used, and check that nothing grows over hours (leak test).
  - agent-mcp: keep caches bounded (trade results, knowledge cache, poe.ninja prices), stream large results, and
    close the headless engine after a few idle minutes instead of keeping a second PoB in memory.
  - The AI side: tool results stay compact (numbers first) so the AI's context stays small, and the tool
    definitions stay within the 5,000-token budget.
- **Disk:** bounded caches with cleanup (icon cache, trade and knowledge caches), character history keeps only the
  last N copies of the build per character, the timeless jewel tables are unpacked once and never duplicated, and
  the updater removes old `.previous` backups after a successful start (keeping one).
- **CPU:** the live server does less work while PoB is unfocused (longer select timeout, no redraw when nothing
  changed), and background checks (update check, icon downloads) stay rare and throttled.

### Steps
1. ✅ `tools/measure.ps1` and a baseline (on 0.6.1, the current release; numbers below).
2. ✅ Release manifest in `build-release.ps1` and delta zips; updater delta mode with a full-zip fallback; tested
   0.7.0 → 0.7.1 with only code changes (local test builds).
3. ✅ Data packs: tree-on-demand download in PoB (from the fork's release tag on GitHub), the offline message, a
   smaller default zip; tested an old build (3.13) and a Ruthless build (3.28 Ruthless).
4. ✅ RAM: profiled the PoB window and agent-mcp, fixed the biggest items, ran a long leak test, added the idle
   shutdown of the headless engine.
5. ✅ Disk: cache limits and cleanup; history retention (already capped); one backup only (the updater mirrors into
   a single `<folder>.previous`).
6. ✅ CPU: idle work in the live server; background checks were already rare (update check once a day, icons 2 at
   a time, only for items on screen).
7. ✅ Re-measured; before/after below and in CHANGELOG "Unreleased".

### Built (2026-11-13)
- **`tools/measure.ps1`** `[-Root] [-Release 0.6.1] [-Zip ...] [-Seconds 10] [-Json out.json] [-Compare before.json]`:
  download sizes (GitHub or local zips), unpacked size per folder (trees split into "current" and "packs"), working
  set / private memory / CPU (% of one core) of every process started from the folder (PoB window, agent-mcp node,
  luajit engines), and AgentCache folders + the updater backup. Read-only.
- **Tree packs.** `build-release.ps1` keeps the newest 3 normal tree versions (`-KeepTrees`, today 3.28-3.30) and
  moves the other 40 (Ruthless, alternate, 2.6-3.27) out of both zips. `PathOfBuilding/src/TreeData/packs.json`
  lists every pack file with size and SHA256 (hashed from an LF export, because raw.githubusercontent.com serves
  the committed bytes) and the source `https://raw.githubusercontent.com/<fork>/refs/tags/agent-edition-v<ver>/src/TreeData/`.
  With `-Publish` it tags the fork commit `agent-edition-v<ver>` and pushes the tag (a bare commit link breaks when
  the fork branch is rebased: 0.6.1's fork commit already returns 404). `3_19/Assets.lua` stays (all trees use it).
  `-NoPacks` builds the old full zip.
- **PoB side** (`Agent/TreePacks.lua`): opening a build in the window that needs a missing tree shows "Passive tree
  needed ... Download it now? N MB" and a progress popup (background thread), then opens the build. The AI's build
  loads (live `load_build_xml`, `restore_build_xml`, `open_build_file`, headless `load_build_xml`) download right away
  and return the offline message as the tool error. Any other path (Tree tab version list, imports) downloads in
  `PassiveTree` itself. One keep-alive connection per pack, one retry per file, every file checked (size + SHA256)
  before it is renamed into place, `tree.lua` last. Git checkouts have no packs.json, so nothing changes there.
  Headless: `Agent/Headless.lua` now has a real `MakeDir` and keeps the real `require` (PoB's HeadlessWrapper hides
  lcurl).
- **Manifest and deltas.** Each release has `release-manifest.json` (path, size, SHA256, `only: zip|portable`) in
  both zips and as the asset `PoB-Agent-Edition-<ver>-manifest.json`, plus delta zips
  `PoB-Agent-Edition-<from>-to-<ver>-update.zip` from the 3 newest earlier releases that have a manifest (on GitHub
  with `-Publish`, else in `dist\`; `-DeltaFrom` picks them). `npm ci` output is byte-identical between builds, so a
  code-only delta holds only our changed files.
- **Updater** (`tools/update.ps1`): if the release has a delta from the installed version and the install has
  `release-manifest.json`, it downloads the delta, checks its SHA256 and every file against the manifest, backs up,
  copies only changed files, removes files the new release dropped (never user files; trees that became packs stay)
  and drops the unpacked cache of a changed timeless jewel table. Anything that doesn't fit (wrong base version,
  missing or changed file) falls back to the full zip. `-Full` skips the delta; `-ZipFile` accepts delta zips. The
  full-zip path now keeps downloaded tree packs (robocopy `/XD`) and afterwards removes any kept pack that no longer
  matches packs.json. Old 0.6.x updaters still work: they take the full zip by its unchanged name.
- **Live server CPU** (`Agent/LiveServer.lua`): focused or under the mouse = full speed; unfocused = 10 fps for 30 s
  after AI activity, then about 3 fps; minimised = 1 fps. Once quiet in the background, one full Lua GC (PoB uses
  `setpause 400`, so the heap may grow to 4x its live size between collections), again at most every 5 minutes.
  New live action `memory` (Lua heap, loaded trees, window state, frame count) for leak tests.
- **agent-mcp:** headless engines (the player's and the side engine) shut down after 5 idle minutes
  (`POB_AGENT_IDLE_MINUTES`, 0 = never); the player's build is exported first and loaded back, unsaved edits
  included, on the next call. Cache limits at server start (`cachePrune.ts`, `POB_AGENT_CACHE_PRUNE=off`):
  knowledge HTTP cache 50 MB / 60 days, snapshots 100 / 90 days, icon pictures 50 MB, answers.log 2 MB. Character
  history was already capped (200 entries, 30 build copies per character).
- `.sha256` files are written with an LF line end (`sha256sum -c` on Linux/macOS).

### Measured (2026-11-13, same PC, OCC Vortex fixture build, `tools/measure.ps1`)
| What | Before (0.6.1) | After (0.7.0 test build) |
|---|---|---|
| Installer zip | 631.6 MB | **246.6 MB** |
| Portable zip | 665.1 MB | **280.2 MB** |
| Update when only our code changed | full zip, 631.6 MB (8.5-11 min) | **0.3 MB** delta (7 files), applied in 4 s |
| Passive trees in the zip (unpacked) | 581 MB (43 versions) | 63 MB (3 versions + shared images); packs 3-25 MB each on demand |
| Opening a build with a missing tree | - | 3.13: 5 MB in 3.8 s; 3.28 Ruthless: 15 MB in 22 s |
| PoB window, unfocused, CPU | 5.9% of a core | **2.6%** |
| PoB window, minimised, CPU | 66-98% of a core, then **crashed** | **0.6-2%** |
| PoB window memory over time (unfocused) | grew ~1.3 MB/s (~0.6 MB/s minimised) | flat; idle GC trimmed Lua heap 299 → 200 MB |
| Headless engine (idle) | ~315 MB kept until the AI app closes | shut down after 5 min (0 MB), build restored on demand |
| agent-mcp server | ~53 MB | ~53-67 MB (unchanged) |
| AgentCache (this PC) | 1 MB, no limits | capped as above |

Leak test (0.7.0 test build, window in the background, an AI request every 5 minutes; stopped at 14 of 60 minutes by the player's choice): working set 1,185-1,222 MB and private 1,639-1,687 MB the whole time, no growth after minute 3; CPU 76% in minutes 1-2 (first start of a fresh install), then 2.2-6.0% of a core; Lua heap 203-292 MB. Open point: this fresh install sits about 400 MB higher than the 0.6.1 checkout with the same LiveServer (750 MB); the cause is not confirmed (no unpacked jewel .bin caches were written), worth a look in Stage 12/13.

Tests: `npm test` (all pass, including new contract tests for the idle shutdown with an unsaved edit and the cache
limits); 0.6.1 zip install updated to 0.7.0 with its **old** `update.ps1` (full zip, 9 s, builds and portable.txt
kept); 0.7.0 → 0.7.1 delta (installer and portable installs); rollback; the new updater with a full zip (downloaded
trees kept); a delta for the wrong version and a tampered delta are refused with nothing changed; headless and live
loads of a 3.13 and a 3.28 Ruthless build; the offline message (HTTP 404 and timeout). Not tested: the GitHub
download branch of the delta path (needs two real releases, so the update after 0.8.0 is its first real run) and clicking
the window's "Passive tree needed" popup by hand.

**Done when:**
- the measured numbers are in this section, with before/after;
- an update that changes only our code downloads under 50 MB;
- the default zip is clearly smaller and still opens old and Ruthless builds (downloading the tree when needed,
  with a clear message when offline);
- the PoB window and agent-mcp use clearly less RAM and CPU when idle, with no growth over a long run;
- caches stay within their limits.

## Stage X — Cross-cutting (ongoing)
- **Testing**: headless tests per feature; real-window checks via second instance on port 31338 +
  `take_screenshot`; `npm test` in agent-mcp; never zero the timeless jewel caches.
- **Safety**: trade governor, instant buyout only, no game-client automation, secrets in AgentEdition.json
  only, character import read-only.
- **Docs**: README, AGENTS.md, agentGuide.ts kept in sync; ROADMAP ticked each chat.
- **Backups**: both repos are local-only on branch `agent` — consider a private GitHub remote (ask first).

---

## Open questions for the player
1. Which Fubgun guide (link) will you follow first? (used to test Stage 3)
2. League plan: start 3.30 league on day one? Trade or SSF at start (profile can change later)?
3. pathofexile.com profile public (for character import), or use PoB's OAuth login?
4. Private GitHub backup of the two repos — yes/no?
5. Windows only, or also another PC/laptop?
6. Where is Path of Exile 1 installed (for the game-data dataset in Stage 9)? Steam or standalone client?
7. Should Stage 9 move earlier (right after Stage 1) so all later features use the knowledge engine?

---

## Key context for any chat
- Paths (repo root): `PathOfBuilding\` (fork), `agent-mcp\` (our MCP server), `luajit\` (pinned LuaJIT 14d8a7a2),
  `tools\`, `atlastree-export\`. Builds: `Documents\Path of Building\Builds`.
  Player settings/secrets: `Documents\Path of Building\AgentEdition.json` (never committed).
- Launch: "PoB Agent Edition" (Start menu). Restart: `tools/restart-pob.ps1 -Background`.
- If `live_status` shows unsaved changes, don't restart/modify the player's window — test in a second
  instance with `POB_AGENT_PORT=31338`.
- Screenshots: live action `take_screenshot` → `PathOfBuilding/runtime/SimpleGraphic/Screenshots`.
- Don't run `HeadlessWrapper.lua` without the Inflate fix (zeroes timeless jewel caches); check
  `src/Data/TimelessJewelData/*.bin` aren't 0 bytes.
- PoB gotchas: `DrawString` RIGHT/CENTER are viewport-relative (use `Viz.text`); font lacks •, –, …;
  EditControl `filter` lists characters to **remove**; PoB's `DownloadPage` isn't binary safe.
- Keep `agent-mcp/src/guide.ts` and `AGENTS.md` in sync. New tools: `agent-mcp/src/tools/` + `PathOfBuilding/src/Agent/Handlers/Tools.lua` + a contract test.
- Commits on branch `agent` in both sub-repos, pushed to the private GitHub repos (see `docs/DEVELOPMENT.md`).
  Record user-facing changes in `CHANGELOG.md` under "Unreleased".
- Player preferences: account safety first, instant buyout only, explain PoE1 for a PoE2 player
  (explanation mode chosen in profile), PoB base identical to official (upstream only as previews).

## How to continue in a new chat
Open a new chat in the repo folder and say, for example:

> Read ROADMAP.md and AGENTS.md. We're doing **Stage 16** (own MCP server). Plan it, ask me anything
> unclear, then build it step by step.

At the end of each chat: tick finished steps here, note new loose ends/ideas, write the user-facing
changes for `CHANGELOG.md` "Unreleased", commit locally, and update the status table. **Don't push**:
message the repo-control session (see below).

## Sessions: one working session + one repo-control session
The player always runs two sessions:
- **Working session** (one per stage): builds the stage and commits locally. Submodules (`PathOfBuilding`,
  `pob-mcp`) commit on `agent`, the root on `main`, and it commits only its own files. It **never pushes, tags or
  publishes**. When a piece of work is done and tested, it messages the repo-control session with:
  the commits (repo + short hash + one line each), the tests and their results, the CHANGELOG "Unreleased" lines,
  and "push only" or "stage finished".
- **Repo-control session** ("Git repo release setup"): reviews the diff, runs `tools\check-secrets.ps1`, pushes
  the forks first and then the root (so submodule pointers always resolve), keeps CHANGELOG in order and
  publishes the release when a stage is finished (steps below). It tells the working session what was pushed.
- **`main` and `agent` only move when a release ships**, so the public README never describes features no release
  has. "Push only" work goes to backup branches `stage-N` on origin (both repos). Several working sessions may
  share one checkout: each commits only its own hunks. If stages finish out of commit order, the repo-control
  session reorders them in a separate git worktree before releasing, so each release contains only its own stage.

## Releases
**Every finished stage gets a GitHub release** (done by the repo-control session). When a stage's "Done when" is met:
1. Run `tools\check-secrets.ps1`, then push both forks (`agent`) and the root (`main`).
2. Set `VERSION` to the new version, then move "Unreleased" in `CHANGELOG.md` to `## [0.N.0] - <date>` (one minor version per stage; fixes in
   between are patch releases, e.g. 0.2.1). Name the stage in the section's first line.
3. `powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -Version 0.N.0 -Publish`
4. Check the release page (zip + .sha256 present, notes correct) and mark the stage ✅ with the version.

| Version | Stages |
|---|---|
| 0.1.0 (2026-11-13) | 0 Foundation, 1 Player profile |
| 0.2.0 (2026-11-13) | 16 Own MCP server (agent-mcp) |
| 0.3.0 (2026-11-13) | 15 Install, portable version & updater |
| 0.4.0 (2026-11-13) | 2 Character import & progress sync |
| 0.5.0 (2026-11-13) | 3 Guide mode |
| 0.6.0 (2026-11-13) | 9 PoE knowledge engine |
| 0.6.1 (2026-11-13) | 3 follow-up: Guide mode 2 (Guide tab, priorities, levelling, sync button) |
| 0.7.0 (2026-11-13) | 13 Data freshness (3.30 uniques preview); roadmap: Stage 11 interview, theorycraft, prices, item targets |
| 0.8.0 (2026-11-13) | 4 Optimiser, 10 AI chat inside PoB, 17 Lighter, Guide tab fixes (one combined release, by the player's choice) |
