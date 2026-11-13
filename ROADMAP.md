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
7. **Works in every client.** Features live in pob-mcp tools + PoB Agent Edition, so Claude, Codex,
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
| 2 | Character import & progress sync | 🔜 |
| 3 | Guide mode | ⬜ |
| 4 | Optimiser (goal-based min-maxing) | ⬜ |
| 5 | Economy: budgets, trade and SSF | ⬜ |
| 6 | Crafting helper | ⬜ |
| 7 | Levelling coach | ⬜ |
| 8 | Farming & money advisor | ⬜ |
| 9 | PoE knowledge (poewiki, poedb, glossary) | ⬜ |
| 10 | AI chat inside PoB (Claude Code / Codex CLI / API key) | ⬜ |
| 11 | Create a build | ⬜ |
| 12 | UI polish | ⬜ |
| 13 | Data freshness | ⬜ |
| 14 | PoE2 edition | 💭 |
| 15 | Updater & update reminder (before first public release) | ⬜ |
| X | Cross-cutting: testing, safety, docs, backups | ongoing |

Recommended order: 1 → 2 → 3 → 4 → 5 → 9 → 7 → 6 → 8 → 10 → 11 → 12/13 → 14.
(1 and 2 are small and everything else uses them; 9 makes every later answer better.)

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
- [ ] Click **Save** in Options › Agent profile with a real mouse (rendering and the MCP→Overview path were
  verified; the Save click itself couldn't be automated).
- [ ] Restart Claude Code / Codex / Antigravity (new tools) and PoB Agent Edition (new UI) to pick it up.
- [ ] Set your profile (Options or tell the AI): trade/SSF, hardcore/softcore, league, currency, goals, explanation mode.
- [ ] Maybe: MCP tool `live_open_options` so the AI can open the profile editor for the player.

**Done when:** switching to SSF or Deep dive visibly changes AI answers; profile survives restarts and
is shared by Claude/Codex/Antigravity.

---

## Stage 2 — Character import & progress sync 🔜

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
1. Drive PoB's character import via live action (`import_character {account, character}`), test public profile.
2. Diff engine: items/gems/passives/stats between two snapshots.
3. History store (`Documents/Path of Building/AgentCache/history/<character>.json`).
4. Overview "Progress" card + MCP `character_sync`, `character_history`.

**Done when:** "sync my character" imports it, lists changes since last sync with numbers, and the
Progress card shows a timeline.

---

## Stage 3 — Guide mode ⬜

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
1. Link/code fetch + decode (pobb.in raw, pastebin raw, poe.ninja) → open as build/specs; tests.
2. Compare engine (tree/masteries/gems/items/config) with PoB simulations.
3. Next-steps ranking + profile awareness.
4. Overview Guide card + MCP tools + AI guide text.

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

## Stage 9 — PoE knowledge engine (accurate, current, cited) ⬜

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
1. Source hierarchy, schema and local KB store; accuracy rules in agentGuide/AGENTS.md.
2. GGG official connectors (patch notes, trade data endpoints) + versioning.
3. poewiki connector (API + Cargo) with revision timestamps.
4. poedb connector with parser tests.
5. Game-file dataset via PoB's exporter (needs PoE1 install path; read-only).
6. Entity linking + conflict detection + freshness/staleness.
7. Tools: `kb_search`, `kb_entity`, `kb_mechanic`, `kb_patch_changes`, `kb_verify`, `kb_compare_games`.
8. Evaluation set + automated accuracy checks.
9. Glossary + Teach-mode integration; patch "what changed for my build" report.

**Done when:** factual answers always carry current sources and versions; the evaluation set passes at
a high accuracy with zero uncited claims; disagreements and outdated facts are flagged; "what changed in
3.30 for my build" is accurate and sourced.

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

## Stage 15 — Updater & update reminder ⬜

**Why:** players install from a release zip, so they need to know when a new version is out and update
with one click, without losing builds or settings. PoB's own updater is off in Agent Edition (it runs in
dev mode from our files) and must stay off, or it would replace our fork with official PoB.
**Do this before the first public release.**

### Features
- **Update reminder (players):** on start, at most once a day, PoB Agent Edition checks the latest
  release of `urbanvcode/pob-agent-edition` on GitHub. If it is newer, the Overview shows a banner such as
  "v0.2.0 is available" with the changelog notes and the buttons **Update now**, **Later** and
  **Skip this version**. Options has a switch to turn checking off. Nothing is sent except the version request.
- **AI knows too:** `live_status` (or a small `update_check` tool) reports "update available x.y.z", and
  the agent guide says to mention it once per conversation, never nag.
- **One-click updater:** `tools/update.ps1` (started from the banner or by hand) downloads the release
  zip over HTTPS, checks its SHA256 against the release's `.sha256` file, waits for PoB to close, keeps
  the current folder as a backup (`..\PoB Agent Edition.previous`), replaces the program files, runs
  `install.ps1` quietly (shortcuts and MCP paths) and restarts PoB. It never touches `Documents\Path of
  Building` (builds, AgentEdition.json). **Roll back** restores the backup.
- **Updates straight from our GitHub repo:** zip installs update from the repo's GitHub Releases (the
  built zip, so no Node build step is needed). Git installs (`git clone --recurse-submodules`) are
  detected by the `.git` folder and update with `git pull` + `git submodule update --init` + `npm ci &&
  npm run build` in pob-mcp, then the same install/restart. Both show the same banner and changelog.
- **Base freshness (developer):** the same check also reports when official PoB has a newer release
  than our base, or GGG has new atlas data (the logic of `update-pob.ps1 -Check` / `update-atlas.ps1 -Check`),
  as a reminder to make a new release.

### Steps
1. Version source of truth: a `VERSION` file at the root, read by PoB (window title, Options) and by
   pob-mcp; `build-release.ps1` checks it matches the CHANGELOG.
2. Release check in PoB (Lua, async `DownloadPage` of the GitHub releases API, daily cache in
   AgentEdition.json, semver compare, skip/snooze stored there).
3. Overview banner + Options switch + changelog popup.
4. `tools/update.ps1`: download, SHA256 verify, backup, swap, install, restart, `-Rollback`;
   git mode (pull, submodules, rebuild) for source installs. Manual update stays documented in the README.
5. `live_status`/`update_check` + agent-guide line (keep AGENTS.md in sync).
6. Test the full path: install v0.1.0 from zip, publish a v0.1.1 test pre-release, get the banner, update,
   roll back; check builds and the POESESSID survive.

**Done when:** a player on an old zip sees the banner, clicks Update now, and is on the new version with
builds, settings and AI connections working; Roll back returns to the old one.
**Note:** the repo is public (2026-11-13), so the check needs no login. GitHub's `/releases/latest`
skips pre-releases (all 0.x releases are pre-releases), so read `/releases` and take the newest by version.

## Stage X — Cross-cutting (ongoing)
- **Testing**: headless tests per feature; real-window checks via second instance on port 31338 +
  `take_screenshot`; unit tests in pob-mcp; never zero the timeless jewel caches.
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
- Paths (repo root): `PathOfBuilding\` (fork), `pob-mcp\`, `luajit\` (pinned LuaJIT 14d8a7a2),
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
- Keep `pob-mcp/src/server/agentGuide.ts` and `AGENTS.md` in sync.
- Commits on branch `agent` in both sub-repos, pushed to the private GitHub repos (see `docs/DEVELOPMENT.md`).
  Record user-facing changes in `CHANGELOG.md` under "Unreleased".
- Player preferences: account safety first, instant buyout only, explain PoE1 for a PoE2 player
  (explanation mode chosen in profile), PoB base identical to official (upstream only as previews).

## How to continue in a new chat
Open a new chat in the repo folder and say, for example:

> Read ROADMAP.md and AGENTS.md. We're doing **Stage 1** (player profile). Plan it, ask me anything
> unclear, then build it step by step.

At the end of each chat: tick finished steps here, note new loose ends/ideas, commit, and update
the status table.
