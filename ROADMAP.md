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
| 3 | Guide mode | ✅ 0.5.0 |
| 4 | Optimiser (goal-based min-maxing) | ⬜ |
| 5 | Economy: budgets, trade and SSF | ⬜ |
| 6 | Crafting helper | ⬜ |
| 7 | Levelling coach | ⬜ |
| 8 | Farming & money advisor | ⬜ |
| 9 | PoE knowledge (GGG patch notes, PoB data, poedb, poewiki, glossary) | ✅ 0.6.0 |
| 10 | AI chat inside PoB (Claude Code / Codex CLI / API key) | ⬜ |
| 11 | Create a build | ⬜ |
| 12 | UI polish | ⬜ |
| 13 | Data freshness | ⬜ |
| 14 | PoE2 edition | 💭 |
| 15 | Install, portable version & updater | ✅ 0.3.0 |
| 16 | Own MCP server (replace pob-mcp) | ✅ 0.2.0 |
| 17 | Lighter: smaller downloads and updates, less memory, disk and CPU | ⬜ |
| X | Cross-cutting: testing, safety, docs, backups | ongoing |

Stage numbers are names, not the order. **Build order:** 0 ✅ → 1 ✅ → 16 ✅ → 15 ✅ → 2 ✅ → 3 ✅ → **4** → 5 → 9 ✅ → 7 → 6
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

Loose ends / ideas:
- Changing a chosen mastery: the cost is not verified (shown as "cost not verified"); Stage 9 can source it.
- Jewels are simulated one by one by hand (PoB's item undo state errors when socketed jewels are rolled back),
  so they are not in "all together".
- Guide rares get "needs a price" (trade_search / plan_upgrades price them); a later step could search them directly.
- Link to Stage 2: a synced character could pick its guide automatically.

**Done when:** paste a Fubgun guide → it opens with stages; "what am I missing?" and "what next with
2 divines?" give ranked, simulated answers with links.

---

## Stage 4 — Optimiser (goal-based min-maxing) ⬜

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

**Done when:** "I'm weak at single target" returns ranked, simulated changes across passives/gems/gear/
config with before/after numbers and explanations at the chosen level.

---

## Stage 5 — Economy: budgets, trade and SSF ⬜

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

---

## Stage 6 — Crafting helper ⬜

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

---

## Stage 7 — Levelling coach ⬜

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
1. Data: quest rewards/vendors per act & class (poewiki), lab/bandit/pantheon milestones.
2. Plan generator from guide leveling specs + PoB tree path ordering.
3. Checkpoint evaluator (resists after penalties, links, DPS sanity).
4. Card + MCP `leveling_plan`, `leveling_next`.

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

## Stage 10 — AI chat inside PoB ⬜

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
1. Spike: run `claude -p` and `codex exec` from a PoB sub-script, stream output, parse JSON.
2. Chat UI panel (input, scroll, streaming text, links).
3. Session handling, context injection, backend picker in Options.
4. Optional API-key backend with tool routing.

**Done when:** typing "why am I weak at bosses?" in PoB streams an answer from Claude Code or Codex
that used the pob tools on the open build.

---

## Stage 11 — Create a build ⬜

### Features
- **Discover**: poe.ninja build data for the league → popular skills/ascendancies, cost tiers, difficulty,
  league-start friendliness; filters from profile (budget, playstyle, SSF-viable).
- **From a guide**: Stage 3 import with stages and the levelling plan (Stage 7).
- **From a popular character**: import a top character, then make a cheaper/staged version
  (Optimiser + Economy to swap expensive items for affordable ones, keeping key mechanics).
- **Adapt** a known build (e.g. "make it tankier", "SSF version") — no blind from-scratch trees.
- Output: build with specs per stage, item sets per budget, notes explaining the build.

### Steps
1. poe.ninja builds data client (league, skill, ascendancy, items, cost).
2. Recommendation + profile filters.
3. Character→build import + "budget version" generator.
4. MCP `build_discover`, `build_create`; Overview onboarding when no build is open.

**Done when:** "cheap bow league starter" → 3 options with cost/difficulty → one opened as a staged build.

---

## Stage 12 — UI polish ⬜
1. Inventory: sockets/links on items, item level/quality badges, empty-socket warnings.
2. Restyle Tree / Items / Skills / Calcs tabs and popups (Options is still grey).
3. Advisor with tabs (Items / Passives / Gems / Other) and "apply in preview".
4. Charts: DPS/EHP history (Stage 2), scaling report (Stage 4).
5. Fixes from real-mouse testing; accessibility (font size, contrast).

## Stage 13 — Data freshness ⬜
1. 3.30 **uniques** preview from PoB PR #10438 (same preview mechanism as the tree).
2. When PoB releases 3.30: `tools/update-pob.ps1` drops the tree preview automatically.
3. Atlas: `tools/update-atlas.ps1` (run by update-pob).
4. League data files for Stages 7/8 (strategies, thresholds) reviewed each league.

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
- **Budget:** all tool definitions together ≤ 5,000 tokens (a test fails above it).
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

**Done when:** every AGENTS.md workflow (profile, diagnose, plan_upgrades, atlas, save as new file) works
on the new server in Claude Code, Claude Desktop and Codex; tool definitions ≤ 5,000 tokens; the PoB
window no longer reads anything from `pob-mcp/`; the submodule is gone and a release is published;
pob-mcp is credited in the README, THIRD_PARTY_NOTICES, `agent-mcp/README.md`, the ported files' headers
and the release notes.

## Stage 17 — Lighter: smaller downloads and updates, less memory, disk and CPU ⬜

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
1. `tools/measure.ps1` and a baseline on 0.4.0 (numbers written into this section).
2. Release manifest in `build-release.ps1` and delta zips; updater delta mode with a full-zip fallback; test
   0.N → 0.N+1 with only code changes.
3. Data packs: tree-on-demand download in PoB (from the fork tag on GitHub), the offline message, a smaller default
   zip; test opening an old build and a Ruthless build.
4. RAM: profile the PoB window and agent-mcp, fix the biggest items, run a long leak test, add the idle shutdown
   of the headless engine.
5. Disk: cache limits and cleanup, history retention, backup cleanup.
6. CPU: idle work in the live server and background checks.
7. Re-measure, and record before/after in this section and in the release notes.

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
