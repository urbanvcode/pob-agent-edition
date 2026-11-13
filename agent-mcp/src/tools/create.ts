/** Create a build (Stage 11): one public tool with modes, see src/create/. */
import { createText, discoverText, interviewText, pricesText, theorycraftText } from "../create/build.js";
import { targetsText } from "../create/targets.js";
import { ToolError } from "../pob.js";
import { S, tool, type Tool } from "../registry.js";
import { resolveLeague } from "./trade.js";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export const createTools: Tool[] = [
  tool("build_create",
    'Create a build. interview: questions (answers: save them in the profile). No mode: popular poe.ninja builds fitting the answers. skill (+class): NEW build from a top character using it. theorycraft: patch-note ideas few play (with skill: build it, labelled theorycraft). targets: each rare as must/nice stats, close instant-buyout items simulated, craft (slot: one). prices: cost per item set.',
    {
      interview: S.bool(), answers: S.obj("playstyle[], content, defence, buttons, pace, novelty, start, budget, hours, likes[], exclude[], playMode, hardcore"),
      skill: S.str(), class: S.str(), theorycraft: S.str('"minions" or core pieces'), targets: S.bool(), slot: S.str(), prices: S.bool(), budget_chaos: S.num(), league: S.str(), limit: S.num(),
    }, [],
    async (ctx, args) => {
      if (args.interview === true || (args.answers && typeof args.answers === "object")) return interviewText(args.answers);
      const { league, note } = await resolveLeague(ctx.trade, args.league);
      const base = { league, leagueNote: note };
      if (args.targets === true || str(args.slot)) return targetsText(ctx, { ...base, slot: str(args.slot), limit: Number(args.limit) || undefined, budget: Number(args.budget_chaos) || undefined });
      if (args.prices === true) return pricesText(ctx, base);
      const skill = str(args.skill), topic = str(args.theorycraft);
      if (skill) return createText(ctx, { ...base, skill, className: str(args.class), theorycraft: topic });
      if (topic) return theorycraftText(ctx, { ...base, topic, limit: Number(args.limit) || undefined });
      if (str(args.class)) throw new ToolError("class needs a skill (build_create { skill, class }).");
      return discoverText(ctx, { ...base, limit: Number(args.limit) || undefined });
    }, { trade: true, writes: (a) => !!str(a.skill) && a.interview !== true && !(a.answers && typeof a.answers === "object") }),
];
