/**
 * Glossary entries. See glossary.ts for the rules.
 *
 * `text` is our own summary; `quote` is a short exact quote from the wiki page
 * named in `page` (poewiki.net for Path of Exile 1, poe2wiki.net for the `poe2`
 * side; both CC BY-NC-SA 3.0). `npm run test:kb` checks every quote against the
 * live page.
 */
import type { GlossaryEntry } from "./glossary.js";

const CHECKED = "2026-11-13T00:00:00Z";
const V1 = "3.30.0";
const V2 = "0.5.5f";

type Entry = Omit<GlossaryEntry, "checked" | "version" | "poe2"> & { poe2?: { text: string; quote: string; page: string } };

const ENTRIES: Entry[] = [
  // ----- defences -----
  {
    term: "Resistance cap", aliases: ["resistance", "resist cap", "max resistance", "maximum resistance", "elemental resistance", "resists"],
    text: "Fire, cold, lightning and chaos resistance reduce damage of that type. The default maximum is 75%; extra maximum resistance raises it up to a hard limit of 90%. Resistance above the maximum gives no further reduction, though some mechanics look at the excess.",
    quote: "Resistances have a default maximum of 75%.", page: "Resistance",
    poe2: { text: "Path of Exile 2 uses the same numbers: a 75% default cap that can be raised to a hard cap of 90%.", quote: "Maximum resistances are soft capped at 75% by default but can be increased to a hard cap of 90%.", page: "Resistance" },
  },
  {
    term: "Spell Suppression", aliases: ["suppression", "suppress", "spell suppress"],
    text: "A dexterity-side defence against spells: a chance for spell hits, and the ailments they inflict, to deal 40% less damage by default. Characters start with no chance; it can be stacked to 100% so every spell hit is suppressed.",
    quote: "By default, it provides a chance to lower the damage of hits and ailments inflicted by spells by 40%.", page: "Spell suppression",
    poe2: { text: "The nearest Path of Exile 2 mechanic is Deflection: a chance, from Deflection Rating against the attacker's Accuracy, to take less damage from a hit.", quote: "It grants a chance to take less damage from a hit by a percentage.", page: "Deflection" },
  },
  {
    term: "Evasion", aliases: ["evade", "evasion rating"],
    text: "A chance to avoid attacks entirely, from your evasion rating against the attacker's accuracy; spells cannot be evaded. The chance cannot exceed 95%. It is not a plain dice roll: an 'entropy' system prevents long runs of hits or misses.",
    quote: "Because chance to hit cannot be lower than 5%, chance to evade cannot exceed 95%.", page: "Evasion",
    poe2: { text: "Works the same way in Path of Exile 2, including the entropy system: Evasion Rating against the enemy's Accuracy Rating.", quote: "Evasion chance is based on your Evasion Rating versus the enemy's Accuracy Rating.", page: "Evasion" },
  },
  {
    term: "Armour",
    text: "Reduces physical damage from hits. It is strong against many small hits and weak against one large hit, never reduces damage over time, and physical damage reduction is capped at 90%.",
    quote: "Physical damage reduction is capped at 90%.", page: "Armour",
    poe2: { text: "Same idea and the same 90% limit in Path of Exile 2.", quote: "The maximum total physical damage reduction from all sources is 90%.", page: "Armour" },
  },
  {
    term: "Energy Shield", aliases: ["es"],
    text: "An extra hit-point pool on top of life that takes damage first and starts recharging after 2 seconds without taking damage. In Path of Exile 1 chaos damage bypasses it and goes straight to life.",
    quote: "Unlike life, energy shield will recharge naturally after the character has not taken any damage for 2 seconds.", page: "Energy shield",
    poe2: { text: "In Path of Exile 2 bleeding and poison bypass energy shield instead, and chaos damage deals double damage to it.", quote: "Bleeding and poison damage bypasses energy shield to damage life directly, while chaos damage deals twice as much damage against energy shield.", page: "Energy Shield" },
  },
  {
    term: "Block", aliases: ["blocking", "block chance", "spell block"],
    text: "A blocked hit deals no damage at all. Block is rolled per hit, works only against hits (not damage over time), and is capped at 75% by default, with a hard cap of 90%. Blocking attacks and blocking spells are two separate stats.",
    quote: "Maximum block chance (for either attacks or spells) is 75% by default.", page: "Blocking",
    poe2: { text: "Path of Exile 2 caps passive block lower, at 50% by default, and adds active blocking with a raised shield.", quote: "By default, maximum block chance is capped at 50%.", page: "Block" },
  },
  {
    term: "Low Life and Full Life", aliases: ["low life", "full life"],
    text: "Two states many modifiers check. Low Life: life at or below 50% of maximum. Full Life: current life equal to maximum life.",
    quote: "Low Life requires life to be less or equal to 50% of the maximum.", page: "Life",
  },
  {
    term: "Guard skill", aliases: ["guard skills"],
    text: "Instant defensive skills that give a short protective buff. All non-Vaal guard skills share one cooldown, so in practice a build uses one of them.",
    quote: "Non-Vaal Guard skills share a cooldown; they cannot be cast or triggered while another is on cooldown.", page: "Guard skill",
  },
  {
    term: "Fortify", aliases: ["fortification"],
    text: "A stacking buff: 1% less damage taken from hits per stack, with a maximum of 20 stacks and a 6 second duration by default.",
    quote: "By default, it has a maximum of 20 stacks and lasts 6 seconds.", page: "Fortification",
  },
  {
    term: "Pantheon", aliases: ["pantheon power", "pantheon powers"],
    text: "Defensive bonuses unlocked by defeating gods in Acts 6 to 10. There are four major and eight minor gods; one major and one minor power can be active.",
    quote: "There are twelve gods that each grant a power; four major gods and eight minor gods.", page: "The Pantheon",
  },

  // ----- resources -----
  {
    term: "Reservation", aliases: ["mana reservation", "reserve", "reserved mana", "reserved"],
    text: "Auras, heralds and other always-on skills are not paid per use: they set aside (reserve) part of your mana or life for as long as they are active. The reserved part cannot be spent, so auras compete with the mana your skills need.",
    quote: "Rather than paying the cost once as with normal skills, a portion of the resource is set aside as unusable for as long as the skill is active.", page: "Reservation",
    poe2: { text: "Path of Exile 2 uses a separate resource, Spirit, for persistent buffs and permanent minions instead of reserving mana.", quote: "Spirit is a resource that can be reserved to activate persistent buffs, summon permanent minions, and enable trigger meta gems.", page: "Spirit" },
  },
  {
    term: "Aura", aliases: ["auras"],
    text: "A skill that gives a lasting effect to you and nearby allies, or a debuff to nearby enemies. Most auras reserve part of your mana or life, and the same aura cannot be active twice.",
    quote: "Most aura skills reserve a percentage or flat amount of your maximum mana (or life) to maintain their effects.", page: "Aura",
  },
  {
    term: "Flask", aliases: ["flasks", "utility flask", "utility flasks"],
    text: "A Path of Exile 1 character carries five flasks: life, mana, hybrid and utility flasks. Utility flasks give temporary bonuses instead of recovery. Flasks refill by killing monsters.",
    quote: "Every character has space for five flasks.", page: "Flask",
    poe2: { text: "Path of Exile 2 has one life and one mana flask; charms, which trigger by themselves, take the place of utility flasks.", quote: "A player can have only one life flask and one mana flask equipped at a time unless otherwise specified.", page: "Flask" },
  },
  {
    term: "Leech", aliases: ["life leech", "mana leech"],
    text: "Recovers life, mana or energy shield over time from the damage your hits deal. Each hit makes a leech instance; all life leech together recovers at most 20% of maximum life per second by default.",
    quote: "The total recovery rate of all life leech instances is limited to 20% of maximum life or mana per second (10% for energy shield).", page: "Leech",
    poe2: { text: "Leech also recovers over time in Path of Exile 2; an instance lasts 1 second by default.", quote: "Leech stacks last for 1 second by default.", page: "Leech" },
  },
  {
    term: "Attributes", aliases: ["attribute", "strength", "dexterity", "intelligence", "attribute requirements"],
    text: "Strength, Dexterity and Intelligence. Gear and gems need enough of them to be used. Each also gives a bonus: 2 strength = 1 life, 2 intelligence = 1 mana, 10 intelligence = 1% energy shield, 5 dexterity = 1% evasion rating, 1 dexterity = 2 accuracy.",
    quote: "A character must meet or exceed an item's attribute requirements in order to use it.", page: "Attribute",
    poe2: { text: "Path of Exile 2 gives more accuracy per dexterity: 6 instead of 2.", quote: "Every 1 Dexterity grants +6 Accuracy Rating.", page: "Attribute" },
  },

  // ----- offence -----
  {
    term: "More and increased", aliases: ["more vs increased", "increased vs more", "more multiplier", "increased damage", "more damage"],
    text: "'Increased' and 'reduced' modifiers are added together into one sum; each 'more' or 'less' modifier multiplies separately. Two 10% increased make 20%; two 10% more make 21%. A build with lots of increased damage gains more from a 'more' modifier.",
    quote: "All unique sources of more damage are multiplicative with each other", page: "Damage",
  },
  {
    term: "Critical strike", aliases: ["crit", "crits", "critical strikes", "crit multi", "critical strike multiplier", "crit chance", "critical strike chance"],
    text: "A hit that deals extra damage. Players start with a 150% critical strike multiplier (50% extra damage). In Path of Exile 1 a critical strike has 100% chance to ignite, freeze and shock if it deals that damage type. Damage over time cannot crit.",
    quote: "Player characters have a base crit multi value of 150%", page: "Critical strike",
    poe2: { text: "Path of Exile 2 calls it a critical hit with a critical damage bonus, +100% by default.", quote: "The default critical damage bonus for players and minions is +100%, or 200% of base damage.", page: "Critical hit" },
  },
  {
    term: "Accuracy", aliases: ["accuracy rating", "chance to hit", "hit chance"],
    text: "Attacks can miss: your accuracy against the target's evasion gives the chance to hit, between 5% and 100%. Spells do not use accuracy. Players gain 2 accuracy per level and per point of dexterity.",
    quote: "Spells do not benefit from accuracy, as they cannot be evaded.", page: "Accuracy",
    poe2: { text: "Same role in Path of Exile 2, with more base accuracy: 6 per level and per point of dexterity.", quote: "Player characters inherently gain 6 base accuracy per level, and 6 base accuracy for each point of dexterity.", page: "Accuracy" },
  },
  {
    term: "Damage over time", aliases: ["dot", "dots"],
    text: "Damage dealt continuously instead of in hits (ignite, poison, bleeding and others). Because it does not hit, it cannot crit or deal double damage, and block and armour do nothing against it.",
    quote: "Unlike the other three damage sources, damage over time does not hit.", page: "Damage over time",
  },
  {
    term: "Damage conversion", aliases: ["conversion", "converted damage"],
    text: "Changes part of a hit's damage into another damage type, in a fixed order that never goes backwards. It does not apply to damage over time.",
    quote: "Steps can be skipped, but damage can never be converted backwards", page: "Damage conversion",
    poe2: { text: "Path of Exile 2 has no strict conversion order, and converted damage is scaled only by its final type.", quote: "This differs from Path of Exile 1, which had a strict order of damage conversion.", page: "Damage conversion" },
  },
  {
    term: "Penetration", aliases: ["resistance penetration", "pen"],
    text: "Your hits treat the enemy's resistance as lower by the penetration amount; the enemy's real resistance is unchanged. It works for hits only, not damage over time, and is not limited by the -200% floor on resistances.",
    quote: "Due to the fact that resistance penetration is a property of hits, it cannot apply to damage over time.", page: "Resistance penetration",
    poe2: { text: "In Path of Exile 2 penetration normally does nothing once the enemy is at 0% resistance or lower.", quote: "Damage Penetration normally applies to Resistances above 0%, so if the Enemy has 0% resistances or less, then penetration does nothing.", page: "Exposure" },
  },
  {
    term: "Exposure",
    text: "A debuff that lowers one elemental resistance of an enemy, by 10% by default when the player applies it. Exposures of the same element do not stack; only the strongest applies.",
    quote: "Exposure debuffs inflicted by the player or their skills apply -10% to the affected resistance by default.", page: "Exposure",
    poe2: { text: "In Path of Exile 2 exposure lowers all three elemental resistances at once.", quote: "Exposure is a debuff which reduces resistances against all three elemental damage types.", page: "Exposure" },
  },
  {
    term: "Curse", aliases: ["curses", "hex", "hexes", "mark", "marks", "curse limit"],
    text: "A debuff on enemies, of two kinds: Hexes and Marks (a Mark is on one target at a time). By default only one curse can be active on an enemy; more need a higher curse limit.",
    quote: "By default, one curse can be active at a time on a creature.", page: "Curse",
    poe2: { text: "Same default limit of one curse in Path of Exile 2.", quote: "By default, the player can apply a maximum of one Curse on an enemy, which can be increased.", page: "Curse" },
  },
  {
    term: "Endurance, Frenzy and Power charges", aliases: ["charges", "endurance charge", "endurance charges", "frenzy charge", "frenzy charges", "power charge", "power charges"],
    text: "Three kinds of temporary charges that give a bonus per charge simply for having them: endurance (strength; physical and elemental damage reduction), frenzy (dexterity) and power (intelligence).",
    quote: "They are associated with strength, and grant additional physical and elemental damage reduction.", page: "Endurance charge",
    poe2: { text: "In Path of Exile 2 charges give nothing by themselves; skills consume them for extra power.", quote: "Charges do not inherently grant bonuses to the character or monsters; they are used to empower skills by being consumed by them.", page: "Endurance charge" },
  },
  {
    term: "Onslaught",
    text: "A buff that does not stack: 20% increased attack, cast and movement speed.",
    quote: "Onslaught Grants 20% increased Attack, Cast and Movement Speed.", page: "Onslaught",
  },
  {
    term: "Minion", aliases: ["minions", "summons"],
    text: "Allied monsters with their own stats. Your own damage and defence modifiers do not apply to them: only modifiers that name minions or allies do.",
    quote: "They do not possess the player's stats unless those stats specifically affect minions or allies.", page: "Minion",
    poe2: { text: "Same rule in Path of Exile 2.", quote: "only modifiers that specify or affect minions or allies will apply", page: "Minion" },
  },

  // ----- ailments -----
  {
    term: "Ailment", aliases: ["ailments", "elemental ailment", "elemental ailments", "status ailment"],
    text: "A debuff applied by a hit of a certain damage type: ignite (fire), freeze (cold), shock (lightning), poison (physical or chaos) and bleeding (physical). Apart from poison they do not stack by default: only the strongest applies.",
    quote: "ailments other than poison do not stack by default; only the strongest effect(s) apply", page: "Ailment",
    poe2: { text: "In Path of Exile 2 a player's ailment threshold is half of maximum life.", quote: "A player's base ailment threshold is based on half of their maximum life.", page: "Ailment" },
  },
  {
    term: "Ignite", aliases: ["ignited"],
    text: "The fire ailment: the target burns for fire damage over time. Base duration is 4 seconds; a target can carry several ignites but only the strongest deals damage.",
    quote: "The base duration of ignite is 4 seconds.", page: "Ignite",
    poe2: { text: "In Path of Exile 2 the chance to ignite comes from Flammability on the target.", quote: "Fire damage hits have chance to apply ignite based on the magnitude of Flammability on the target.", page: "Ignite" },
  },
  {
    term: "Freeze", aliases: ["frozen"],
    text: "The cold ailment that stops a target from moving or using skills. Its duration depends on the hit's cold damage relative to the target's ailment threshold; a freeze shorter than 0.3 seconds is discarded.",
    quote: "the freeze duration must be at least 0.3 seconds, otherwise it will be discarded", page: "Freeze",
    poe2: { text: "Path of Exile 2 adds Freeze Buildup: hits too small to freeze fill a counter, and at 100% the target freezes.", quote: "When freeze buildup reaches or exceeds 100%, it will apply a fixed duration freeze to the target, then reset the counter to 0%.", page: "Freeze" },
  },
  {
    term: "Shock", aliases: ["shocked"],
    text: "The lightning ailment: the target takes increased damage from all sources, up to 50% by default, for a base 2 seconds. Larger lightning hits relative to the target's life shock harder.",
    quote: "Shock's default maximum effect is 50%.", page: "Shock",
    poe2: { text: "In Path of Exile 2 shock is 20% increased damage taken unless stated otherwise.", quote: "Shock grants a debuff of 20% increased Damage taken.", page: "Shock" },
  },
  {
    term: "Poison", aliases: ["poisoned"],
    text: "Chaos damage over time from physical or chaos hits that have a chance to poison. Unlike the other ailments, poisons stack. One poison deals 30% of the hit's physical plus chaos damage per second as its base.",
    quote: "The base damage per second dealt by a single poison is based on 30% of the combined flat physical and chaos damage of the hit.", page: "Poison",
    poe2: { text: "In Path of Exile 2 poison has a stack limit of 1 by default.", quote: "Poison can stack and has a default stack limit of 1; this can be increased through various stats or modifiers.", page: "Poison" },
  },
  {
    term: "Bleeding", aliases: ["bleed"],
    text: "Physical damage over time from physical attack hits. A bleeding target that moves takes three times the base damage. By default only the strongest bleed deals damage.",
    quote: "Only physical damage hits can inflict bleed.", page: "Bleeding",
    poe2: { text: "Also non-stacking in Path of Exile 2: only the highest-damage bleed deals damage.", quote: "Bleeding does not stack; each instance of bleeding has an independent duration and only the highest damage instance of bleeding will deal damage.", page: "Bleeding" },
  },
  {
    term: "Stun", aliases: ["stunned", "stuns"],
    text: "A hit that is large compared with the target's maximum life can stun, interrupting it briefly; the base stun lasts 350 ms. Damage over time cannot stun.",
    quote: "The base duration of the stun animation is 350ms.", page: "Stun",
    poe2: { text: "Path of Exile 2 splits this into Light Stun and a Heavy Stun that builds up.", quote: "Stun is separated into two types: Light Stun, which has a chance to briefly interrupt targets based on the damage, and Heavy Stun, which lasts longer and is accumulated on the target.", page: "Stun" },
  },

  // ----- gems and sockets -----
  {
    term: "Skill gem", aliases: ["skill gems", "active skill gem", "gems", "gem"],
    text: "In Path of Exile 1 a skill comes from a gem placed in a socket of your gear. Gems gain experience and level up, which raises their effect and also their level and attribute requirements.",
    quote: "is an item class which grants skills to the player by placing them into an item socket", page: "Skill gem",
    poe2: { text: "In Path of Exile 2 skill gems go into the skill panel, not into gear.", quote: "Skill gems can be socketed in the skill panel to gain an active skill which can be assigned on the player's keybinds.", page: "Gem" },
  },
  {
    term: "Support gem", aliases: ["support gems", "supports"],
    text: "Modifies a skill gem it is linked to and multiplies that skill's mana cost. Two copies of the same support on one skill add nothing: only the higher-level one applies.",
    quote: "However, if two copies of a given support gem are linked to the same skill, only the higher level gem will apply.", page: "Support gem",
  },
  {
    term: "Sockets and links", aliases: ["links", "link", "linked sockets", "six link", "6-link", "6 link", "sockets", "socket"],
    text: "Gear has gem sockets. A support gem only affects a skill gem whose socket is linked to its own, so the number of linked sockets on one item (six at most) limits how many supports a skill can have.",
    quote: "Gem sockets can be linked together, which is required for support gems to provide benefits to linked skill gems.", page: "Item socket",
    poe2: { text: "Path of Exile 2 has no links on gear: sockets on weapons and armour hold runes and other augments instead.", quote: "Augment sockets (also known as rune sockets or item sockets) are slots found on weapons and armour into which augments can be placed", page: "Augment socket" },
  },
  {
    term: "Vaal skill", aliases: ["vaal skills", "vaal gem", "vaal skill gem", "souls"],
    text: "A corrupted skill gem that grants the normal skill plus a much stronger Vaal version, which is charged with souls from killing enemies.",
    quote: "Souls can be obtained by killing enemies, granting 1 souls per kill.", page: "Vaal skill",
  },

  // ----- passive tree -----
  {
    term: "Passive skill tree", aliases: ["passive tree", "skill tree", "passive points", "passive skill", "passive skill points"],
    text: "One shared tree for all classes, each starting in a different place. A character gets 99 points from levels and 23 from quests, plus 1 optional point from the bandit quest.",
    quote: "Characters can accrue 99 passive skill points from levels, 23 points from quests, and 1 optional point from the quest Deal with the Bandits if all three Bandit Lords were killed.", page: "Passive skill",
    poe2: { text: "Path of Exile 2: 99 points from levels and 24 from quests, 123 in total.", quote: "Each character can gain up to 99 passive points from levels and 24 from quests, for a total of 123 skill points.", page: "Passive Skill Tree" },
  },
  {
    term: "Keystone", aliases: ["keystones"],
    text: "A special passive that changes how a character plays. Some unique items grant a keystone without spending a passive point on it.",
    quote: "A Keystone is a unique and powerful passive skill node that significantly impacts the way a character is played.", page: "Keystone",
  },
  {
    term: "Mastery", aliases: ["masteries", "passive mastery"],
    text: "After allocating a notable in a passive cluster you can spend one more point on that cluster's Mastery and choose one bonus from its list.",
    quote: "Allocating a mastery passive requires one skill point.", page: "Mastery",
  },
  {
    term: "Ascendancy", aliases: ["ascendancy class", "ascendancies", "ascend"],
    text: "A subclass with its own small passive tree, chosen after the first Labyrinth run. Each Labyrinth gives 2 ascendancy points the first time, 8 in total.",
    quote: "Upon completing the Labyrinth for the first time, the player can choose an Ascendancy class for their character", page: "Ascendancy class",
    poe2: { text: "Path of Exile 2 unlocks ascendancies through Ascension Trials instead of the Labyrinth; also 8 points.", quote: "Players can complete 4 tiers of Ascension Trials, each granting 2 ascendancy skill points for a total of 8.", page: "Ascendancy class" },
  },
  {
    term: "Labyrinth", aliases: ["lab", "the labyrinth", "lord's labyrinth", "uber lab"],
    text: "A dungeon of traps and three fights against Izaro, with a layout that changes daily and no checkpoints. Finishing it the first time unlocks the Ascendancy class.",
    quote: "There are no waypoints or checkpoints in a Labyrinth.", page: "The Lord's Labyrinth",
  },
  {
    term: "Bandit quest", aliases: ["bandits", "deal with the bandits", "bandit"],
    text: "An Act 2 quest with a lasting choice: kill all three bandit leaders for 1 passive skill point, or help one of them for that bandit's bonuses instead.",
    quote: "There are 4 options to this quest: kill all of the bandit leaders and receive a passive skill point from Eramir", page: "Deal with the Bandits",
  },
  {
    term: "Cluster Jewel", aliases: ["cluster jewels", "cluster"],
    text: "A jewel for the outermost (large) jewel sockets of the tree that adds a new group of passives there: small nodes, notables and sometimes more sockets for smaller cluster jewels.",
    quote: "These jewels extend the skill tree by creating new clusters of nodes", page: "Cluster jewel",
  },
  {
    term: "Timeless Jewel", aliases: ["timeless jewels"],
    text: "Six unique jewels that change the passives and keystones around their socket, depending on the seed number and name on the jewel.",
    quote: "Timeless Jewel is the basetype of a set of six unique jewels that can alter the passive tree nodes.", page: "Timeless Jewel",
    poe2: { text: "The Path of Exile 2 counterpart is the Time-Lost jewel, which changes passives in its radius.", quote: "Time-lost jewels do not inherently provide any stats, but will instead modify other passive skills in its radius.", page: "Jewel" },
  },
  {
    term: "Anoint", aliases: ["anointment", "anointing", "anoints", "anointed", "oil", "oils"], topic: true,
    text: "Oils from Blight encounters are applied through Cassia to amulets, rings, blighted maps and Blight uniques to add an enchantment; what it does depends on the item type.",
    quote: "An oil is a currency item that can be acquired from Blight encounters.", page: "Oil",
  },

  // ----- items and crafting -----
  {
    term: "Rarity", aliases: ["item rarity", "rare item", "magic item", "unique item", "uniques"],
    text: "Items are normal, magic, rare or unique. Magic and rare items have random modifiers; a unique has its own fixed set of modifiers. Most rare items have 4 to 6 modifiers.",
    quote: "The four rarities are normal, followed by magic, rare and unique.", page: "Rarity",
  },
  {
    term: "Prefix and suffix", aliases: ["prefix", "prefixes", "suffix", "suffixes", "affix", "affixes", "explicit modifier", "explicit modifiers"],
    text: "An item's random modifiers are split into prefixes and suffixes. A magic item has up to 1 of each; a rare item up to 3 of each (jewels 2 of each). Crafting is mostly about which of these slots are still free.",
    quote: "Rare - random modifiers based on conditions: (1 to 3) prefixes and (1 to 3) suffixes", page: "Modifier",
    poe2: { text: "Same limits in Path of Exile 2.", quote: "Rare items can have up to six affixes, having maximum three prefixes and three suffixes.", page: "Rarity" },
  },
  {
    term: "Item level", aliases: ["ilvl"],
    text: "A level every item has, set by where it dropped. It decides which modifiers the item can roll, so it matters for crafting. Hold Alt over an item to see it.",
    quote: "Item level mainly determines what affixes are available to the item.", page: "Item level",
  },
  {
    term: "Quality",
    text: "Improves an item's main stat, such as a weapon's physical damage or an armour's defences, by 1% per 1% quality, or adds a bonus to a gem.",
    quote: "Each 1% quality improves the result by 1%.", page: "Quality",
    poe2: { text: "Path of Exile 2 limits quality to 20% by default.", quote: "All Items that can have Quality applied to it have a default limit of 20% Quality.", page: "Quality" },
  },
  {
    term: "Corrupted", aliases: ["corruption", "corrupt", "vaal orb", "vaal orbs", "corrupted item"],
    text: "A Vaal Orb corrupts an item with an unpredictable result: it can improve the item or make it worse. A corrupted item can no longer be changed by most crafting methods, so corrupting is a last step and a gamble.",
    quote: "Corrupted items and strongboxes cannot be altered with most crafting methods", page: "Corrupted",
    poe2: { text: "Same in Path of Exile 2.", quote: "Vaal Orb is a currency item that corrupts an item, modifying it unpredictably and preventing it from being further modified.", page: "Vaal Orb" },
  },
  {
    term: "Chaos Orb", aliases: ["chaos orbs", "chaos"],
    text: "Rerolls all random modifiers of a rare item. It is also one of the orbs most used as money between players, which is why prices are quoted in chaos.",
    quote: "Chaos Orb is a currency item that can be used to re-roll the random modifiers on a piece of rare equipment.", page: "Chaos Orb",
    poe2: { text: "In Path of Exile 2 it swaps one modifier instead of rerolling all of them.", quote: "Chaos Orb is a currency item that removes a random modifier and adds a random modifier to a rare item.", page: "Chaos Orb" },
  },
  {
    term: "Divine Orb", aliases: ["divine orbs", "divine", "divines"],
    text: "Rerolls the values of an item's random modifiers within their tiers; it does not change which modifiers the item has. It is also used as high-value money between players.",
    quote: "A Divine Orb will not change the tier of the affix; it will only re-roll within its current tier.", page: "Divine Orb",
    poe2: { text: "Same effect in Path of Exile 2.", quote: "Divine Orb is a currency item that randomizes the numeric values of modifiers on an item.", page: "Divine Orb" },
  },
  {
    term: "Exalted Orb", aliases: ["exalted orbs", "exalt", "exalts", "exalted"],
    text: "Adds one new random modifier to a rare item without touching the others.",
    quote: "Exalted Orbs add a random explicit modifier to a rare item.", page: "Exalted Orb",
    poe2: { text: "Same effect in Path of Exile 2.", quote: "Exalted Orb is a currency item that can be used to add another modifier to a rare item.", page: "Exalted Orb" },
  },
  {
    term: "Crafting Bench", aliases: ["bench craft", "bench crafts", "bench", "crafted modifier", "crafted mod"],
    text: "A station in towns and in your hideout that adds one chosen modifier to an item for a currency cost. Normally an item holds only one crafted modifier, and it needs a free prefix or suffix slot.",
    quote: "Typically, only one crafted modifier may be added to an item", page: "Crafting Bench",
  },
  {
    term: "Influenced item", aliases: ["influence", "influenced", "shaper item", "elder item"],
    text: "Special bases (Shaper, Elder or Conqueror influence) with extra modifiers that normal items cannot roll. They cannot also have Eldritch implicits.",
    quote: "Influenced items are special types of base items with an expanded pool of exclusive modifiers", page: "Influenced item",
  },
  {
    term: "Eldritch implicit", aliases: ["eldritch implicits", "eldritch", "eater of worlds implicit", "searing exarch implicit"],
    text: "Implicit modifiers from the Searing Exarch and the Eater of Worlds. Items with Shaper, Elder or Conqueror influence cannot have them.",
    quote: "Eldritch implicit modifier refers to Eater of Worlds implicit modifier or Searing Exarch implicit modifier.", page: "Eldritch implicit modifier",
  },

  // ----- endgame and game modes -----
  {
    term: "Map", aliases: ["maps", "mapping"],
    text: "The Path of Exile 1 endgame: a map is an item used to open portals to a map area. Maps have rarities and modifiers like gear, and can be used from the Epilogue, after the campaign.",
    quote: "Players cannot use maps until the Epilogue.", page: "Map",
    poe2: { text: "Path of Exile 2 uses Waystones for this.", quote: "Waystones are items that can be activated in the Map Device to access maps on the Atlas.", page: "Waystone" },
  },
  {
    term: "Atlas", aliases: ["atlas of worlds"],
    text: "The endgame's map of maps: a network of linked map areas that is revealed and progressed by running map items in the Map Device.",
    quote: "The Atlas is revealed and explored by running map items within a Map Device.", page: "Atlas of Worlds",
    poe2: { text: "The Path of Exile 2 Atlas is infinite instead of a fixed network.", quote: "The atlas is infinite and expands in all directions.", page: "Atlas" },
  },
  {
    term: "Atlas passive tree", aliases: ["atlas tree", "atlas passives", "atlas passive skill tree", "atlas points"],
    text: "A second passive tree for the endgame. Points earned by progressing through maps are spent to improve the rewards and encounters of maps.",
    quote: "Progressing through maps allows the player to obtain passive skill points to allocate in the Atlas tree", page: "Atlas Passive Skill Tree",
  },
  {
    term: "League", aliases: ["leagues", "challenge league", "challenge leagues"],
    text: "A separate game world with its own economy; a character belongs to one league. A new challenge league with a fresh start is released roughly every 13-16 weeks.",
    quote: "Roughly every 13-16 weeks, a new challenge league is released that provides players with a fresh start.", page: "League",
  },
  {
    term: "Solo Self-Found", aliases: ["ssf", "solo self found"],
    text: "A character flag that turns off trading and partying, so everything is found or crafted by yourself. It can be removed at any time, but can only be chosen when the character is created.",
    quote: "the SSF flag can be removed from a character at any time", page: "Solo Self-Found",
  },
];

export const GLOSSARY: GlossaryEntry[] = ENTRIES.map(({ poe2, ...e }) => ({
  ...e,
  checked: CHECKED,
  version: V1,
  ...(poe2 ? { poe2: { ...poe2, version: V2 } } : {}),
}));
