# AGENTS.md — PoB Agent Edition

Guide for any AI model (Claude, Codex, Antigravity, …) working with this setup.
The same rules are sent automatically by the `pob` MCP server on connect
(`agent-mcp/src/guide.ts`); keep the two in sync.

## Plan
- The roadmap with all stages and steps is in `ROADMAP.md`. When working on this project, read it first, work on one stage/step, and tick it off at the end.

## What's here
- `PathOfBuilding/` — PoB Agent Edition (our fork, branch `agent`): live API, Overview dashboard, inventory with icons, AI Advisor card.
- `agent-mcp/` — our MCP server (34 tools): talks to the PoB Agent Edition window, or to a headless PoB when it is closed. Its Lua side is `PathOfBuilding/src/Agent/Handlers/`.
- Builds live in `Documents\Path of Building\Builds` (in the user's Documents folder).

## Start
1. `profile_get` (once per conversation) and follow its "How to answer" rules. The player profile (play mode, hardcore/softcore, league, currency, goals, experience, explanation mode, learned topics) is shared by every AI client and editable in PoB Agent Edition › Options › Agent profile; the Overview header shows it.
2. `status`. If PoB Agent Edition is open, every tool works on the build in the window and the user sees changes live. Otherwise load a saved build (`list_builds`, `open_build`). If it says an update is available, mention it once in one line (the player updates from the Overview banner or `tools\update.ps1`); never nag or update anything yourself.
3. Use PoB's calculations (`diagnose`, `stats`, `what_if`) instead of estimating. Every result names its config assumptions (enemy, charges, flasks); mention them when they matter.

## Diagnose in this order (`diagnose` does it in one call)
1. Elemental resistances capped, then chaos resistance.
2. Survivability: weakest max hit, EHP, life/ES, suppression/evade/block, freeze and stun.
3. Recovery and mana: leech/regen, reservation, attribute requirements.
4. Damage: main skill DPS, supports, crit/speed, damage by type.

## Player profile
- **Play mode**: `trade` = buying upgrades is fine (instant buyout only). `ssf` = Solo Self-Found, no trading: never suggest buying or run trade searches for purchases; suggest crafting, farming and drop targets. `mixed` = give both, labelled [Trade] and [SSF].
- **Hardcore**: a death moves the character to softcore for good, so defences come before damage, risky choices are flagged with a safe option, and trade uses the Hardcore league.
- **Explanation mode**: `teach` = explain a PoE1 mechanic the first time it matters (1-3 sentences, compared with PoE2), then `profile_mark_learned` so it isn't repeated; `concise` = actions and numbers, one line of why; `deep` = full mechanics and maths (increased vs more, DPS formula, EHP layers) with PoB's numbers.
- Use the profile league and currency as defaults for trade tools and budgets. Change it (`profile_set`) only when the player asks or states a fact ("I have 300c", "I'm SSF now").
- Stored under `profile` in `Documents\Path of Building\AgentEdition.json` (schema: `PathOfBuilding/src/Agent/Settings.lua` and `agent-mcp/src/profile.ts`, keep in sync).

## Character sync (progress)
- "Sync my character": `character_sync { account: "Name#1234", character }` (both remembered after the first sync). It imports the public pathofexile.com profile with PoB's own importer into its own build "<character> - synced" (other builds untouched, config kept), saves it, and lists what changed since the last sync: items, gems, passives, with DPS/EHP/max-hit deltas from PoB.
- `character_history` shows the timeline; the Overview **Progress** card draws it. History: `Documents\Path of Building\AgentCache\history\`.
- Read-only and polite: 3 requests per sync, paced and inside the limits the site publishes, at most one sync per character per minute. A private profile: the player makes the Characters tab public; never ask for a password or POESESSID.

## Cheap upgrades (trade or mixed mode)
- `plan_upgrades { budget_chaos, focus }` searches instant-buyout listings, simulates each in the build and ranks by gain per chaos. Results also show in the Overview's **AI Advisor** card.
- League defaults to the profile league, else the current challenge league (`leagues` lists them). Default budget 50c per item, capped by the currency on hand.
- `plan_upgrades { focus: "resists" }` finds gear that caps the resistances that are short. `currency` gives exchange rates.
- `suggest_gems` (support gems), `suggest_passives` (tree), `anoint` (amulet) and `suggest_jewels` (jewel mods, Watcher's Eye, cluster notables) simulate every option in PoB. `affixes` gives affix tiers and crafting-bench mods and classifies an item's mods (open prefixes/suffixes).
- "Can I do <boss>?": `diagnose { boss }`. It uses PoB's boss skill presets; PoB has no boss life data, so judge damage separately and say so.

## Optimiser (Stage 4)
- "I'm weak at single target", "I keep dying", "more damage": `optimise { goal }` with goal `bossing` (pinnacle boss, single-target DPS without culling), `clear` (no boss, DPS + movement speed + area), `tankiness` (EHP + weakest max hit + uncapped resists), `balanced`, or `weakest` (picked from `diagnose`). The goal's config is temporary and restored afterwards.
- It simulates passives within `points` (default 6, with paths), respecs (net gain per Orb of Regret), mastery effects, support swaps and gem levels/quality, auras/heralds/curses, utility flasks, anoints, pantheon and bandit, ranks them by gain per cost (a point, a regret or one change = 1), and lists config the player may be under-counting (only if true in their fights), what does not fit the reserved mana, and a scaling report (what +1 step of each stat is worth). Each suggestion carries `what_if` ops and its mechanic; explain it per the explanation mode (teach: the glossary lines it returns, then `profile_mark_learned`). Hardcore drops changes that cost defence for another goal.
- Gear: `budget_chaos` adds `plan_upgrades` (trade/mixed; Stage 5 will widen it); SSF gets the scaling report as what to look for. Results also fill the Overview's AI Advisor tabs (Items / Passives / Gems / Other).

## Atlas tree
- `atlas_get` (points, mechanics, combined bonuses, share link), `atlas_search` (node ids + cost), `atlas_edit` (add/remove/replace/import link). 150 points; explain what each league mechanic does for a PoE1 newcomer. Save the build to keep it.

## Guides (Stage 3)
- `guide_import { source }` takes the guide's PoB code or a pobb.in / poe.ninja / pastebin / maxroll link (Mobalytics pages are JS-only: ask for the guide's PoB link) and saves it as a new "Guide - <name>" build; the guide's loadouts are its stages. Several stage builds: one "Stage: link" per line. The guide's notes are kept (`guide_compare { notes: true }`).
- `guide_compare` compares the open build with a guide stage (detected, or `stage`): passives ordered into a path, masteries, gems, items, config, headline numbers and "what explains the gap", all simulated in PoB.
- `guide_next_steps { budget }` ranks actions by gain per cost (passive points, chaos), respecting trade/SSF and the currency on hand; trade links are instant-buyout searches. Both update the Overview's Guide card.
- When the player deliberately differs (another unique, gem or passive), `guide_compare { accept: [...] }` stops flagging it.
- PoB has a **Guide tab** that does the same without an AI (tree overlay with the next passives numbered, Sync character button): `set_view { view: "GUIDE" }` shows it. Advice is weighed by what the character lacks (`FOCUS`: resists, defence or damage) and levelling stages follow campaign rules.

## Facts: look up, cite, never guess (Stage 9)
- Before stating a game fact (a mechanic, an item, a gem, a patch change) call `kb_lookup { query }`. Your own memory may be outdated or mix in PoE2: it only tells you what to look up, it is never the answer.
- Every fact comes with its source, link, game version and date. Cite them, and quote numbers and wording exactly. If nothing is found, say it could not be verified and how to check; don't fill the gap.
- Source ranking when they disagree: game data > official GGG > PoB data > poedb > poewiki. Pass on the flags: "may be outdated" (written before the current patch) and "sources disagree". PoE2 facts (`source: "poe2"`, or the glossary's comparison) are always labelled and only used for comparisons.
- Teach mode: `kb_lookup` on a PoE1 term returns its glossary entry first (a short explanation with its quoted source and how PoE2 differs); use that for the first explanation, then `profile_mark_learned`.
- `kb_lookup { query, claim }` checks a statement: supported / contradicted / not found, with the sentence it rests on.
- `kb_patch` reads GGG's official patch notes: `{ version: "3.30" }` a league, `{ filter }` a text or section, `{ build: true }` only the lines naming the open build's gems, uniques, keystones, notables and ascendancy. General changes can affect a build without naming its parts: say what was and wasn't checked.
- "Is this good for my build?" is not a fact from a text: simulate it (`what_if`). Numbers for the player's build always come from PoB.
- Fetching is polite: robots.txt is obeyed, requests are paced and capped per question, pages are cached (`AgentCache\knowledge`). If a site asks for a pause, say so; don't retry.

## AI chat inside PoB (Stage 10)
- PoB has its own chat panel (right edge of the build screen). It runs `agent-mcp/build/chat/bridge.js`, which starts Claude Code (`claude -p --output-format stream-json`), Codex (`codex exec --json`) or the Anthropic API with a fresh agent-mcp server pinned to that window (`POB_AGENT_PORT`, `POB_LIVE=only`). No new MCP tools: the chat uses the same tools and rules.
- In the panel the AI writes `[[node:Name]]`, `[[item:Name]]`, `[[gem:Name]]` (clickable links) and `[[apply:Label|{"ops":[...]}]]` (Preview = what_if, Apply = edit, both by PoB). Edit tools are off unless the player switches on "AI may edit".
- Backend, sign-in and API key: Options > AI chat backend. The key (`anthropicApiKey` in AgentEdition.json) is read by the bridge only; never print it or pass it on a command line.
- Tests: `npm test` includes `tests/chat.test.mjs` (fake CLIs and a fake API). Live: the actions `chat_send { message }` / `chat_state { last }` drive the panel of a test window (port 31345).

## Trade rules (account safety)
- Instant buyout only. Never whisper, auto-buy or touch the game client — the user clicks the buyout.
- Requests are paced (1 per 2 s), kept inside every limit pathofexile.com publishes, and capped at 16 per question. If the site asks for a pause, tell the user; don't retry in a loop.
- The POESESSID is set in PoB Agent Edition › Options; never ask for it or print it.

## The player
- Default (unless the profile says otherwise): knows Path of Exile 2, new to Path of Exile 1. Explain PoE1 terms and systems at the depth the explanation mode asks for, relate them to PoE2 and point out differences.

## Changing builds
- Never overwrite the user's build file. Save AI changes as a new file (`save_build` with a `note` of what changed and a name like `<build> - AI <change>`); overwrite only when asked.
- `status` shows unsaved changes: ask before `open_build` replaces them.
- Try a change with `what_if` first (it rolls back), then apply it with `edit_items` / `edit_skills` / `edit_tree` / `set_config`.
- Show before/after numbers; switch the window to the relevant tab (`set_view`).

## Developing this project
- **Two sessions per stage:** one **working session** does the stage, and one **repo-control session** ("Git repo release setup") owns git pushes and releases.
  - Working session: commit locally (submodules on `agent`, root on `main`, only your own files), but **never push, tag or publish**. When work is done and tested, message the repo-control session with the commits (repo + hash + one line each), the tests and their results, the CHANGELOG "Unreleased" lines, and whether the stage is finished.
  - Repo-control session: review the diff, run `tools\check-secrets.ps1`, push the forks first and then the root (submodule pointers), update CHANGELOG, and publish the release when a stage is finished.
- **Every finished stage is released on GitHub**: changelog → new minor version → `tools\build-release.ps1 -Version x.y.z -Publish` (steps in ROADMAP.md › Releases). Add user-facing changes to `CHANGELOG.md` under "Unreleased" as you go.
- Releases are light (Stage 17): old and Ruthless passive trees are downloaded on demand from the fork tag `agent-edition-v<ver>` (`-Publish` creates it), and each release ships a manifest and small delta zips that `tools\update.ps1` tries before the full zip. Measure size, RAM and CPU with `tools\measure.ps1` before and after a change.
- Always credit the projects we build on, even after replacing them: Path of Building Community, and [ianderse/pob-mcp](https://github.com/ianderse/pob-mcp) for our MCP server (README credits, THIRD_PARTY_NOTICES, a header in every ported file, release notes). Details: ROADMAP.md › Stage 16 › "Credit to pob-mcp, always".
- The repos are public: never commit secrets, personal paths or a personal e-mail (commits use the GitHub no-reply address); run `tools\check-secrets.ps1` before pushing.
- Update PoB: `tools/update-pob.ps1` (`-Check` first). Dev helpers: `tools/restart-pob.ps1`, `tools/snap-pob.ps1`.
- Don't run PoB's `HeadlessWrapper.lua` directly; use `PathOfBuilding/src/Agent/Headless.lua` (it has the Inflate fix). Check `src/Data/TimelessJewelData/*.bin` aren't 0 bytes if numbers look off.
- agent-mcp tests: `npm test` in `agent-mcp` (unit + headless contract tests, includes the 5,000-token budget for tool definitions); `npm run test:live` against a PoB window (use a second instance: `POB_AGENT_PORT=31338`).
- New tools go in `agent-mcp/src/tools/`, their PoB side in `PathOfBuilding/src/Agent/Handlers/Tools.lua`; each tool gets a contract test.
