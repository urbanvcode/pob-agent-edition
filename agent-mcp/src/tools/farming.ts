/** Stage 8: farming & money advisor (public as modes of `atlas`: farm, goal, log). */
import { farmingText } from "../farming/plan.js";
import { S, tool, type Tool } from "../registry.js";
import type { TradeApiClient } from "../trade/client.js";
import { resolveLeague } from "./trade.js";

export function farmingTools(trade: TradeApiClient): Tool[] {
  return [
    tool("farming_plan", "Farming advisor: content the build can do, strategies with atlas presets, Threads, prices, progression, money plan, SSF targets; log records a session.",
      { farm: S.str(), goal: S.str(), log: S.obj(), league: S.str(), points: S.num() }, [],
      async (ctx, args) => {
        const { league, note } = await resolveLeague(ctx.trade ?? trade, args.league);
        return farmingText(ctx, { farm: args.farm === true ? "true" : args.farm, goal: args.goal, log: args.log, league, leagueNote: note, points: Number(args.points) || undefined });
      }, { trade: true }),
  ];
}
