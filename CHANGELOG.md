# Changelog

All notable changes to PoB Agent Edition are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Each release also lists the official Path of Building Community version it is based on.

## [Unreleased]

### Fixed
- **Farming advisor: map survival was judged far too harshly**: every map tier, even T1, was checked against the same boss hit (PoB quietly kept the enemy at your character level), so white maps looked as dangerous as T16. Each tier now uses its own area level, your own boss settings (a boss skill you picked in Configuration) no longer turn every map boss into that skill, and the advisor says what it assumes: PoB's average map-boss hit, split about 23% each physical, fire, cold and lightning plus 9% chaos. Your weakest single damage type is now shown on its own line instead of looking like the reason for the verdict.
- **Farming advisor: more to farm, and when to sell**: it used to offer only Breach, Legion and Blight. It now knows 16 strategies (new: Harvest, Heist, divination cards and the Covens of Umbra league mechanic; Betrayal and Ultimatum now show what their rewards sell for), each with a quote and link, shows the top 3 in full and the rest in a short list (`limit` shows more in full), and says why Harbinger is missing (removed from the game in 3.28). Every priced reward now shows poe.ninja's price trend and trade volume, with "falling fast: sell soon" and "thin market: may not sell" warnings. It still never guesses profit per hour; only your own logged sessions count.
- **Auras you have socketed but switched off**: when you import or sync a character, the game doesn't say which auras are on, so PoB counts them all and the AI used to report "mana over-reserved" as a real problem. Now it lists which skills reserve your mana and asks you which ones you actually run before calling it a problem, and an aura you switch off in your synced build stays off at the next sync.

## [0.9.0] - 2026-11-14

One release for five new helpers: economy (Stage 5), crafting (Stage 6), levelling (Stage 7), farming and money (Stage 8) and build creation (Stage 11), plus a simpler tool list for the AI and a safer AI chat with Codex. Based on **Path of Building Community v2.67.2** (same as 0.8.0), with the 3.30 passive tree and unique previews. **After updating, restart your AI app** so it loads the new tools.

### Added
- **Shopping plan for your whole budget** (Stage 5): tell the AI "I have 3 div and 150c" (or let it use the currency in your profile) and it works out the best combination of items to buy across all your gear slots, not just the best single item. PoB tries the whole set on your build at once, because gains overlap, and makes sure the set doesn't drop a resistance below the cap or leave you short on strength, dexterity or intelligence for your gear. You also get "save for" items that beat what fits now, and roughly what the items you replace will sell for. Instant buyout only; you still click buy yourself.
- **What your items are worth**: ask the AI what to sell and it prices your uniques and gems from poe.ninja (unused ones first), without any trade-site requests.
- **Solo Self-Found and mixed players**: instead of purchases, SSF gets a list per slot of what a rare must roll to be worth keeping (for example "+60 to maximum Life alone beats your ring"), worked out by PoB for your build; mixed players see both. Crafting and farming help follow in later stages.
- **Fairer prices**: listings far cheaper than the rest (often bait or price-fixing), far more expensive, or weeks old are set aside, and currency rates are remembered for a while so repeat questions are quicker and still work when poe.ninja is down.

- **Crafting helper** (Stage 6): ask "how do I craft a ring with life and two resistances?" or "craft me gloves like the guide" and the AI plans it: which ways of crafting work for that item (Orbs of Alteration and Regal Orbs, Chaos Orbs, Essences, the crafting bench), ranked by what they cost on average at today's poe.ninja prices, with the steps to follow, the chance of success per try, and a "stop and buy" point (how many tries your currency covers and how likely you are to be done by then). The odds come from Path of Building's own data on how often each mod rolls; the crafting rules they rest on are quoted with their source (poewiki, GGG's 3.30 patch notes), and what no source tells us is shown as a range or "unknown" instead of a guess. It also checks what the same item costs to buy (instant buyout only) and shows how much the finished item would help your build in PoB. Fossils, Harvest, meta-crafting, Recombinators and Eldritch implicits are listed with what they do, without odds, because their weights are not in our data.
- **Quick bench fixes**: "what can I bench on my gloves?" lists every crafting bench mod that fits the free prefix or suffix of the item you wear, each tried on your build in PoB and ranked.
- **Solo Self-Found** crafting uses only things that drop for you and shows how many orbs to expect; the SSF and mixed shopping plans now point straight to a craft plan with the stats PoB found for each slot.

- **Levelling coach** (Stage 7): ask "make me a levelling plan" (or "what should I do next?" while levelling) and the AI lays out the campaign act by act for your class: which passives to take around which level (from your guide's levelling stages, or from your build if you have no guide), which gems you get as quest rewards or can buy from which vendor in each act, when to swap your main skill and when to add links. It also lists the milestones: the four Labyrinths (when they open, which trials you need and which ascendancy points to take), the bandit choice in Act 2 (each option tried on your build in PoB), the Pantheon gods you unlock from Act 6, and all 23 quests that give a passive point. Gear checkpoints show your resistances now and after the -30% penalties at the end of Act 5 and Act 10, your main skill's links, movement speed boots, and the vendor recipes that help (movement speed boots, weapon damage, Chromatic Orbs). Game facts come from poewiki with their links (checked against GGG's 3.30 patch notes); numbers come from PoB.
- **"Where am I, what's next?"**: "sync my character" now adds a line like "level 34 in Act 4 - next: ..." while you are below level 90, and a new **Levelling card** on the Overview shows your act, your resistances after the next penalty and your next steps (it follows the guide picked in the Guide tab and hides from level 90).

- **Farming and money advisor** (Stage 8): ask "how should I make currency?" or "what can my build farm?" and the AI first checks, in PoB, what your build can survive and kill: map tiers 1 to 16 (how many hits a map boss needs to kill you, how fast a rare monster dies), pinnacle and uber bosses, Delirium levels and Simulacrum, and which map mods hurt your build most (for example "no regeneration" or "monsters have more resistance"), each tried on your build. It then suggests 2-3 farming strategies your build suits (Breach, Legion, Expedition, Ritual, Essence, Delirium and the other league mechanics), each with a ready atlas passive tree setup you can apply in the Atlas tab, how to use the new 3.30 Threads in the map device (they replace Scarabs) and what that costs, and what the strategy's loot sells for on poe.ninja today (estimates, with the price date). A step-by-step atlas path for newcomers goes from white maps to voidstones, Nightmare maps (the old "tier 17") and uber bosses, marking where your build is now. Game facts are quoted with their source (poewiki, GGG's 3.30 patch notes) and re-checked each league.
- **Your own profit per hour**: drop rates are not published, so the advisor never makes up a currency-per-hour number. Tell the AI what a session earned ("10 maps of Legion in an hour, about 500c, spent 100c on Threads") and it remembers it; "how long until I can afford 5 div / Headhunter?" then answers in hours at the rate you actually measured, and points to the shopping plan for what that money buys.
- **Solo Self-Found farming**: SSF players get what to farm for instead of a money plan: the materials each strategy yields (Essences, Oils, Omens, Delirium Orbs, ...), where the build's uniques come from, and how to get Threads without trading.

- **Create a build** (Stage 11): say "help me pick a build" and the AI first asks a short set of questions (how you like to fight: melee, bows, spells, minions, totems, traps, mines, damage over time; clear or bosses; tanky or glass cannon; how many buttons; big slow hits or fast ones; proven or new; budget, trade or SSF, hardcore, hours per week; and what you don't want). Your answers are saved in your player profile, so every AI app sees them and you can change them any time.
- **Builds that fit you**: the AI then lists what people really play this league on poe.ninja that matches your answers, with how many characters use it, the most common ascendancies, the uniques most of them wear and what those cost on poe.ninja today. Each suggestion says which of your answers it matches and which it could not check (difficulty and "league start friendly" are not measured by any source, so it says so).
- **A new build from a real character**: pick one and the AI loads up to three of the top characters using that skill into PoB, compares their damage, toughness and unique cost, and saves the one that fits you best as a **new** build file (your own builds are never touched). Its notes say where it came from and anything PoB cannot calculate in it (for example an item line PoB does not understand), and you get the next steps: tune it with the optimiser, levelling plan, item targets, cost.
- **Theorycraft mode (experimental)**: ask "what's new in 3.30 for minions?" and the AI reads GGG's official patch notes (quoted with links), shows which of the named skills, supports and uniques few players use yet on poe.ninja, and can turn one into a build: it starts from the closest real build and swaps the new skill in, then PoB calculates it. These builds are always marked "theorycraft, not tested by players".
- **"Close enough" items instead of exact ones**: exact rares are almost never for sale, so every rare in a build becomes a target. PoB works out how much each stat on the item is worth to your build, splits them into must-haves and nice-to-haves with an acceptable range (e.g. "Lightning Resistance 30+"), searches instant-buyout listings that have the must-haves and tries each one on your build ("81% of the target for 1 alch"). It also shows a crafting plan for the must-haves, and for uniques with variable rolls how good a roll you really need ("any roll is fine", or "95 or more"). SSF players get the must-haves as loot and crafting targets, with no trade searches.
- **Cost per stage**: the AI adds up what each item set of a build costs today (uniques and gems from poe.ninja, rares from the close-enough search), always with the league and the time it checked.

### Fixed
- **Gear upgrade searches without a trade login**: the trade site refuses PoB's weighted searches unless you are logged in (POESESSID in Options), so upgrade and resistance searches found nothing. They now fall back to a simpler search that the site accepts, and PoB still tests every listing on your build.

### Changed
- **The AI uses fewer, simpler PoB tools** (26 instead of 42, plus the new `build_create` = 27): tools that did similar jobs are now one tool each, for example one `suggest` for passives, anoints, support gems and jewels, one `guide` for importing, comparing and next steps, one `atlas`, one `prices` (item prices, currency rates, leagues) and one `edit` for items, gems and passives. Everything they did still works the same way. The tool list your AI apps load at the start of every conversation is about a third smaller (3,050 instead of 4,750 tokens) and the AI's rule sheet about half (680 instead of 1,200), which leaves room for the coming stages (economy, crafting, levelling, farming, build creation) without making conversations heavier. AI apps that still use the old tool names keep working.
- **AI chat with "AI may edit" off is stricter**: the PoB tools themselves now refuse anything that would change, open or save a build, including keeping a simulated change, not only the edit tools being hidden.

### Security
- **AI chat with Codex is locked down to the PoB tools**, like Claude Code. In 0.8.0 the chat's Codex still had its own read-only shell, could open local image files, and could see the apps connected to your ChatGPT account (for example Gmail or GitHub). A prompt injection, such as text from a fetched web page, could in principle have led it to read files such as `AgentEdition.json` (your POESESSID and API key). Now the chat starts Codex with its shell, command runner, image viewer, connected apps, plugins, browser, computer control, web search, memories and hooks switched off, still in its read-only sandbox and outside any project folder. Checked on 2026-11-14: asked to read a dummy secret file, Codex and a helper agent it started could not; writing a file was blocked; PoB questions still work. Tests now fail if the chat's Codex or Claude Code ever gets a shell, file, web or app tool back.

## [0.8.0] - 2026-11-13

One release for four pieces of work: the optimiser (Stage 4), the AI chat inside PoB (Stage 10), much smaller downloads and updates (Stage 17), and Guide tab fixes. Based on **Path of Building Community v2.67.2** (same as 0.7.0), with the 3.30 passive tree and unique previews.

### Optimiser (Stage 4)

#### Added
- **Optimiser** (Stage 4): ask "I'm weak at single target" or "I keep dying" and the AI's new `optimise` tool picks a goal (single target / bossing, clear, tankiness, balanced, or "fix weakest" from the build's diagnosis), sets the config that goal needs for the run only (put back afterwards) and simulates every lever in PoB: passives within N points with their path, respecs (net gain per Orb of Regret), mastery effects, support gem swaps, gem levels and quality, auras, heralds and curses, utility flasks, anoints, pantheon and bandit. Results are ranked by gain per cost, each with before/after numbers, the mechanic that makes it work (explained at your explanation level, with its source) and side effects ("costs 4% EHP"). It also lists config you may be under-counting, auras that would help but don't fit your mana, and a **scaling report**: what one more step of each stat (10% more damage, +100 life, +1% max resistance, ...) is worth for your build. With a budget it adds instant-buyout gear from `plan_upgrades`; Hardcore never trades defence away for damage.
- **AI Advisor tabs** on the Overview: Items (gear from `plan_upgrades`), Passives, Gems and Other (from the optimiser). Hover a row for its numbers and cost, click to open the tab where the change is made.

### AI chat inside PoB (Stage 10)

#### Added
- **AI chat inside PoB** (Stage 10): a chat panel docked on the right of the build screen (hide it with `>`, the **AI Chat** tab on the right edge opens it again). Ask "why am I weak at bosses?" and the answer streams in from **Claude Code** or **Codex** with your own login, or from the Anthropic API with your own key. The AI works on the build in the window with the same PoB tools and rules as your AI apps, and gets the open build, your profile (play mode, league, currency, explanation mode) and your guide stage automatically.
- In chat answers, passives, items and gems are **links**: hover for the tooltip, click to find them (tree search, Items list, Skills group). Suggested changes come as cards with **Preview** (PoB simulates it and shows before/after, nothing changes) and **Apply** (changes the build in the window; it is never saved over your file).
- **AI may edit** toggle in the panel (off by default): off, the AI can only read and simulate, and changes come as Preview/Apply cards; on, it may change the build in the window when you ask. Quick prompts ("Why am I dying?", "Next upgrade", "Weak at bosses?"), Stop, New chat, and one conversation per build that continues where you left off.
- **AI chat model** per backend in Options. The default is the balanced, mid-priced model, never the most expensive one: Claude Code Sonnet (Haiku cheaper, Opus strongest), Codex GPT-6.1-Sol at low reasoning effort (GPT-6-Luna cheaper, GPT-6-Astra strongest), API Sonnet 5.5 (Haiku 5.5 cheaper, Opus 5.5 strongest). The panel shows the model in use.
- **Options > AI chat backend** with a **Sign in** button (opens the CLI's own sign-in window: `claude auth login` / `codex login`) and an optional **Anthropic API key** field. The key stays in `AgentEdition.json` on this PC, is never shown again, and is only sent to api.anthropic.com. Claude Code and Codex are found on PATH, in their usual install folders or inside the Claude / Codex desktop apps.

#### Security
- The chat never touches the game client and trade stays instant-buyout only. The CLIs run with their built-in command, file and web tools switched off, only the pob tools (edit tools only when you allow them), in their read-only sandbox, outside any project folder, and pinned to this PoB window. No POESESSID, API key or build file path is passed to a backend; Cancel ends the backend and everything it started.
- New dependency: Anthropic's official TypeScript SDK (`@anthropic-ai/sdk` 1.3.0) for the optional API-key backend.

### Lighter: smaller downloads and updates, less CPU and memory (Stage 17)

#### Added
- **Smaller downloads** (Stage 17): the zips are about 247 MB (installer, was 632 MB) and 280 MB (portable, was 665 MB). Ruthless, "alternate" and older passive trees (about 514 MB unpacked) are no longer in the zip: when you open a build that uses one, PoB asks and downloads just that tree (3-25 MB) from GitHub, checks every file, and keeps it for next time. The AI's tools download it on their own. Offline, PoB says which tree is missing and how big it is instead of failing.
- **Small updates** (Stage 17): from this release on, **Update now** downloads only the files that changed (a few MB when only our code changed; a test update was 0.3 MB instead of 247 MB). The first small update is the one after 0.8.0; updating *to* 0.8.0 still downloads the full (now much smaller) zip. Every file is checked against the release's manifest; if anything doesn't match, the updater falls back to the full zip on its own. Passive trees you downloaded are kept across updates and rollbacks. `tools\update.ps1 -Full` forces the full zip.
- `tools\measure.ps1`: download sizes, disk use per folder, RAM and CPU of the PoB window, the AI server and the headless engine, and the size of caches and backups, with a before/after comparison.

#### Changed
- **Less CPU and memory in the background** (Stage 17): PoB in the background now runs at about 3 frames a second when nothing happens (10 while the AI is working, 1 when minimised, full speed when focused or under the mouse) and tidies up its memory once it goes quiet. Measured with a build loaded: unfocused 5.9% -> 2.6% of a CPU core, minimised 0.6-2%.
- The AI server shuts its background PoB engine down after 5 idle minutes (frees about 315 MB each) and brings the build back exactly as it was, unsaved changes included, on the next question. `POB_AGENT_IDLE_MINUTES` changes the wait (0 = never).
- The AI server keeps its caches within limits: web pages for facts 50 MB / 60 days, snapshots 100 files / 90 days, item icons 50 MB, the answers log 2 MB. Character history keeps its existing limits (200 entries, 30 build copies per character).

#### Fixed
- **Minimised PoB used a full CPU core and kept growing until it crashed** (0.6.x, with a build loaded): it now idles at 1 frame a second when minimised, and its memory stays flat.
- The release `.sha256` files end in LF, so `sha256sum -c` works on Linux and macOS too.

### Guide mode fixes (follow-up to Stage 3)

#### Added
- **Hide panel** button in the Guide tab: hides the guide panel on the left so the tree uses the whole width; **Show panel** brings it and the Analyse results back. The choice is remembered.

#### Fixed
- **Guide tab crash** (0.6.1): opening the Guide tab with a guide imported stopped PoB with "attempt to index global 'build'" when no AI app had talked to the window yet. The tab and the Sync character button now always work on their own build.
- The Guide tab now saves your stage choice, kept differences and the Overview card on a fresh install too (it could not create its `AgentCache` folder there).

## [0.7.0] - 2026-11-13

Stage 13: data freshness. Based on **Path of Building Community v2.67.2** (official PoB has not released 3.30 yet), with the 3.30 passive trees and unique changes as previews.

### Added
- **3.30 unique changes (preview)** from Path of Building's open pull request #10438 by Can Uysal: Pre 3.30.0 versions of Steelworm, Malachai's Loop, Shavronne's Wrappings, The Hallowed Monarch, Shadowstitch and Rotmother's Mutiny, and Steelworm's "8 Steel Shards" projectile bonus now counts (new config option "Consumed 8 Steel Shards Recently?"). Like the 3.30 tree preview, it is removed automatically once an official Path of Building release includes it.

### Changed
- `tools\update-pob.ps1`: preview markers can name text a release must contain (`<path> contains "<text>"`), and `-Check` also works while the PoB folder has uncommitted changes. Checked on 2026-11-13: official Path of Building is still v2.67.2 and GGG's atlas export is unchanged.

## [0.6.1] - 2026-11-13

Guide mode 2 (follow-up to Stage 3). Based on **Path of Building Community v2.67.2** (same as 0.6.0).

### Added
- **Guide tab** in PoB (button "Guide" under Party/Compare): pick a guide and a stage (or Auto, the closest stage), import a guide from its link or code, and press **Analyse**. PoB simulates every difference in your build and shows the next passives, gems and gear in order. Your tree is drawn with the guide's stage over it (green = take it, red = not in the guide) and the next passives numbered 1, 2, 3; click a step to jump to it on the tree or open its instant-buyout search. "keep" marks a deliberate difference so it is not flagged again.
- **Priorities by what you lack**: resistances under their cap come first; otherwise defence or damage, whichever is further behind the guide stage, counts more (Hardcore leans to defence). The Guide tab, the Overview card and the AI's `guide_compare` / `guide_next_steps` show the focus and why.
- **Rush target**: the best passive target 3 or more points away (counting its path), shown in the Guide tab, on the tree and by the AI.
- **Levelling guides and stages** are treated differently: the stage is picked from your level and passive points, the next points follow the guide's tree without counting respecs, gear advice is about links and levelling uniques (no budget ranking), gems your level can't use yet are listed for later, the next stage's new skills are named with the level they need, and the Act 5 / Act 10 resistance penalties are pointed out.
- **Sync character** button in the Guide tab, and an optional **auto-sync every 15 minutes** while PoB is open (off by default). It re-imports the character you synced before (3 requests to your public pathofexile.com profile, 2 s apart, at most once a minute, a 10-minute pause if pathofexile.com asks for one) and adds the result to the Progress history.

## [0.6.0] - 2026-11-13

Stage 9: PoE knowledge engine. Based on **Path of Building Community v2.67.2** (same as 0.5.0).

### Added
- **Knowledge engine** (Stage 9): the AI now looks game facts up instead of answering from memory. Every fact it gets carries its source, a link, the game version it describes and the date it was read, so answers can be checked. Sources, highest first: GGG's official patch notes, Path of Building's data, poedb, poewiki. When they disagree, or when a wiki page was last edited before the current league, the answer says so.
- `kb_lookup`: facts about a mechanic, unique item, gem or term. It can also check a statement ("the block cap is 75%": supported, contradicted or not found, with the sentence it rests on) and fetch the Path of Exile 2 side for a comparison, always labelled as PoE2.
- `kb_patch`: GGG's official patch notes for a league or a single patch, filtered by text, or **only the lines that name something in your open build** (gems, unique items, keystones, notables, ascendancy). Lines that only apply to Ruthless are kept apart.
- A glossary of 62 Path of Exile 1 terms for players coming from Path of Exile 2 (resistance cap, spell suppression, reservation, links, flasks, ailments, crafting orbs, maps, ...), each with a short quoted source and, where it helps, how PoE2 differs.
- The current game version is detected from GGG's patch-notes forum and the wiki's version table. If Path of Exile is installed (Steam or standalone), its last patch time is read (read-only) so the version is re-checked right after a patch.

### Notes
- Fetching is polite: each site's robots.txt is obeyed, requests are paced and capped per question, pages are cached in `AgentCache\knowledge`, and a site that asks for a pause is left alone. Nothing personal is sent; the client identifies itself as `pob-agent-edition`.
- Wiki text is community-written ([poewiki](https://www.poewiki.net) and [poe2wiki](https://www.poe2wiki.net), CC BY-NC-SA 3.0) and poedb is unofficial; both are quoted briefly with a link and ranked below official sources.
- Reading the game's own data tables is not included yet: it needs an extra extractor tool that Path of Building does not ship.
- For developers: `npm run test:kb` in `agent-mcp` checks the engine against the live sites (121 questions, every glossary quote, each site's parser).

## [0.5.0] - 2026-11-13

Stage 3: guide mode. Based on **Path of Building Community v2.67.2** (same as 0.4.0).

### Added
- **Guide mode** (Stage 3): paste a guide's PoB link (pobb.in, poe.ninja, pastebin, maxroll) or code and ask your AI to import it. It is saved as a new "Guide - <name>" build (nothing is overwritten); the guide's loadouts (Starter, Mid game, Endgame, ...) are its stages and its notes are kept. Several stage links, one "Stage: link" per line, become one guide build.
- "What am I missing?": `guide_compare` compares your build with a guide stage (it finds the stage you are at): passives ordered into a path to take next, masteries, gems per skill group, items and jewels per slot, config differences and the headline DPS / EHP / max hit / resists, with **what explains the gap**. Every gap is simulated in your build by PoB, and your build is put back exactly.
- "What next with 2 divines?": `guide_next_steps` ranks passive points by gain per point and purchases by gain per chaos within your budget (poe.ninja prices, instant-buyout trade links), with the Orb of Regret cost of a respec. SSF profiles get farm and craft targets instead of purchases; Hardcore counts defence double.
- Overview **Guide** card: passives, gems and key items matched, DPS and EHP against the guide, and the next 3 steps (hover for the numbers, click to open the tab or the trade search).
- Deliberate differences (another unique, gem or passive) can be accepted once and are never flagged again.

## [0.4.0] - 2026-11-13

Stage 2: character import and progress sync. Based on **Path of Building Community v2.67.2** (same as 0.3.0).

### Added
- **Character sync** (Stage 2): ask your AI to "sync my character". It imports your character from your public pathofexile.com profile with PoB's own importer into its own build, "<character> - synced" (your other builds are never touched), and lists what changed since the last sync: new or swapped items, gems levelled, passives allocated or refunded, with DPS, EHP and max-hit changes calculated by PoB. Your account and character are remembered after the first sync.
- `character_sync` and `character_history` MCP tools. Each sync is stored in `Documents/Path of Building/AgentCache/history/` with a copy of the build.
- Overview **Progress** card: DPS, EHP, max hit and level over time as sparklines, with each sync's values on hover and what changed last time.
- Safe by design: read-only, no login and no password, 3 requests per sync, paced inside the limits pathofexile.com publishes, at most one sync per character per minute. A private profile gets a clear message on how to make the Characters tab public.

## [0.3.0] - 2026-11-13

Stage 15: install, portable version and updater. Based on **Path of Building Community v2.67.2** (same as 0.2.0). From this version on, PoB Agent Edition tells you when a newer version is out.

### Added
- **Portable version** (Stage 15): a second download, `PoB-Agent-Edition-<version>-win64-portable.zip`. Unzip it and double-click `Start PoB Agent Edition.cmd`: no installer, no shortcuts, no registry changes, and no Node.js to install (it brings its own, the official Node.js 24 LTS). `Connect AI apps.cmd` connects Claude Desktop, Claude Code and Codex; `Disconnect AI apps.cmd` removes the entry again; `mcp-config.txt` has the entry for connecting by hand.
- **Portable data mode**: with `portable.txt` in the folder (`Connect AI apps.cmd` asks), builds and settings stay inside the folder under `UserData`, for USB sticks or players who want nothing outside the folder.
- **Update reminder**: once a day PoB Agent Edition asks GitHub whether a newer version is out (nothing else is sent). The Overview then shows a banner with **What's new**, **Update now**, **Later** (hides it for a day) and **Skip this version**. Switch it off, or check right away, in **Options > Check for Agent Edition updates**. Your AI app mentions a new version once per conversation.
- **One-click updater** `tools\update.ps1` (started by **Update now**, or by hand): works for the installer, portable and git versions. It downloads the matching zip from GitHub, checks its SHA256, waits for PoB to close, keeps the old version in `<folder>.previous`, replaces the program files, renews the AI connections if you had set them up and restarts PoB. Builds and settings are never touched. `-Rollback` goes back, `-Check` only reports, `-ZipFile` updates from a zip you downloaded yourself.

### Changed
- The window title and the footer show the Agent Edition version and the official PoB version it is based on, e.g. `v0.3.0 (PoB 2.67.2)`.
- `Install.cmd` has `-Portable` and `-Quiet` modes (used by `Connect AI apps.cmd` and the updater).

### Fixed
- `Install.cmd` now adds the `pob` entry for Claude Code when there is no `claude` command (Claude Code inside the Claude desktop app). Windows PowerShell broke the helper, so the entry was silently missing; run `Install.cmd` again if your AI app doesn't see the `pob` tools.
- The installer no longer stops when Windows reports no Start menu or Desktop folder.

## [0.2.0] - 2026-11-13

Stage 16: our own MCP server. Based on **Path of Building Community v2.67.2** (same as 0.1.0). **After updating, run `Install.cmd` again and restart your AI app** so it connects to the new server.

### Added
- **`agent-mcp`, our own MCP server**, replaces the pob-mcp fork. It is built around the PoB Agent Edition window: 34 focused tools instead of 115, and about 3,600 tokens of tool definitions instead of about 16,000, so every AI conversation starts lighter and answers get shorter. It is based on and inspired by [pob-mcp](https://github.com/ianderse/pob-mcp) by ianderse (GPL-3.0), from which the build operations, the trade client and other parts are ported. Thank you!
- `diagnose`: the whole health check in one call, in priority order (resistances, max hit and EHP, recovery and mana, damage), with a list of findings.
- `what_if`: try any mix of gear, gem, passive and config changes, see before/after numbers, and the build is rolled back exactly. Nothing flickers in the window.
- `edit_items`, `edit_skills`, `edit_tree` and `set_config` change the open build and report before/after numbers. `edit_tree` takes the shortest path to a passive and picks mastery effects.
- `suggest_passives` (nearby notables, keystones and mastery effects ranked by gain per point), `anoint` (best amulet anoints with oil recipes) and `affixes` (affix tiers and crafting-bench mods from PoB's data).
- `suggest_gems`: shows what each support gem in a skill is worth (damage lost without it), then tries every support that fits in place of the weakest one and ranks them. It uses gem levels your character can actually equip, points out gems you only need to level up, and keeps supports that change how the skill plays (mines, totems, Barrage) out of the ranking.
- `diagnose` with a boss ("shaper", "uber maven", ...): how hard each of that boss's skills hits your character after your defences, how many hits you survive, and a ready / risky / not ready verdict. The numbers come from PoB's own boss presets.
- `plan_upgrades` with focus "resists": finds cheap gear that caps the resistances that are short, ranked by how much is really fixed after the old item comes off. Chaos resistance waits until the elemental ones are capped.
- `suggest_jewels`: which mods to look for on a jewel, abyss jewel, Watcher's Eye or cluster jewel, each simulated in your build.
- `affixes` can classify an item (equipped or pasted): prefix or suffix, tier, bench crafts, open slots, and it says when it cannot be sure.
- `currency`: exchange rates in chaos and what your currency on hand is worth.
- `save_build` can record what was changed in the build's notes and can return a PoB share code; `build_summary` can return a guide's full notes.
- `snapshot`, `restore` and `compare` (current build, snapshots or saved builds: stats, tree, items, gems). Comparing never touches the window.
- `trade_search` takes stat filters as plain text and can simulate each result in a gear slot. `price_check` shows the cheapest instant-buyout listings and warns about bait prices.
- Every result names the config it was calculated with (enemy, charges, active flasks).
- The server finds PoB by itself: the AI app's config is one line, with no paths to LuaJIT or PoB. It switches to the PoB window as soon as you open it (no reconnect step), and works on saved build files when PoB is closed.
- `open_build` can import a PoB export code. It refuses to replace unsaved changes unless you agree.

### Changed
- Tool names are shorter (`status`, `open_build`, `save_build`, `set_view`, `stats`, `leagues`, ...). The old `lua_*` and `live_*` tools are gone; see `AGENTS.md`.
- `save_build` never overwrites your file by accident: AI changes need a new name unless you ask for an overwrite.
- Trade searches are instant buyout only, with no setting to turn that off. Pace and limits are unchanged (1 request per 2 seconds, inside every limit pathofexile.com publishes, 16 per question).
- Trade tools use the profile league, or the current challenge league when none is set.
- The PoB window no longer loads anything from the MCP server's folder: its AI handlers live in the PoB fork (`src/Agent/Handlers/`).

### Removed
- The `pob-mcp` folder and its 115 tools. Everything useful from it has a counterpart in the new server, except what has its own roadmap stage: crafting advice (Stage 6), levelling plans (Stage 7) and build creation (Stage 11). Watch mode is not needed any more (the server reads the open window), and currency arbitrage and config presets were dropped. You can delete the old `pob-mcp` folder after running `Install.cmd`.

### Fixed
- Turning a flask on or off through the AI now changes the calculated numbers at once (before, only after reloading the build).
- Choosing a mastery effect through the AI no longer drops tattoos and other passive overrides.

## [0.1.0] - 2026-11-13

First private preview. Based on **Path of Building Community v2.67.2**, with the 3.30 passive trees taken early from [PoB PR #10437](https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10437).

### Added

#### PoB Agent Edition (the PoB window)
- Live API inside the PoB window (`127.0.0.1:31337`, this PC only), so AI tools read and edit the open build and the changes appear right away.
- Overview dashboard with a dark theme: damage by type, interactive cards, skills, gear and ailments.
- In-game style inventory with item icons.
- **AI Advisor** card that shows the ranked results of `plan_upgrades`.
- Atlas tab: atlas passive tree planner with GGG's official 3.30 data. You can drag, zoom, allocate by shortest path, search, import and copy official links, and open a summary of points per mechanic, notables and combined bonuses. It is saved inside the build.
- Atlas card on the Overview. The newest atlas data version is detected automatically.
- Options: trade session ID (POESESSID), stored locally in `Documents\Path of Building\AgentEdition.json`.
- **Agent profile** in Options: play mode (trade, SSF or mixed), Hardcore or Softcore, league, currency, goals, PoE experience and explanation mode (Teach, Concise or Deep dive). Every AI app shares it, and it shows as chips in the Overview header. The `open_options` live action opens it.

#### MCP server (pob-mcp)
- Live mode: every `lua_*` tool works on the build in the PoB Agent Edition window. New tools: `live_status`, `live_open_build`, `live_save_build`, `live_set_view` (including the OVERVIEW and COMPARE tabs).
- `plan_upgrades`: searches instant-buyout trade listings, simulates each item in the build and ranks the results by gain per chaos.
- Atlas tools: `atlas_get` (points per mechanic, combined bonuses, share link), `atlas_search`, `atlas_edit`.
- Player profile tools: `profile_get` (the profile plus "how to answer" rules for each mode), `profile_set` (checks the league against pathofexile.com) and `profile_mark_learned` (so a PoE1 mechanic is explained only once). `live_status` shows a profile line. `plan_upgrades` defaults to the profile's league and warns in SSF.
- Built-in agent guide that tells any AI client the diagnosis order, the trade safety rules and how to explain PoE1 to PoE2 players.
- Reads the POESESSID from PoB Agent Edition when `POE_SESSION_ID` is not set.
- Trade searches default to instant buyout (`POE_TRADE_ONLINE_STATUS=securable`).

#### Project
- One-step Windows installer (`Install.cmd`) with Start menu and desktop shortcuts and automatic MCP setup for Claude Desktop, Claude Code and Codex.
- `tools/update-pob.ps1` re-applies our changes on the newest official PoB release, then runs a compile check and a smoke test.
- `tools/update-atlas.ps1` pulls GGG's official atlas tree export.
- `tools/build-release.ps1` builds the release zip.

### Changed
- Trade API requests stay inside every rate limit pathofexile.com publishes (at most 1 request every 2 seconds and 16 per question), and the per-window rate governor was fixed.

### Fixed
- `get_build_issues` only counts jewel sockets on allocated passives.

[Unreleased]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/urbanvcode/pob-agent-edition/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/urbanvcode/pob-agent-edition/releases/tag/v0.1.0
