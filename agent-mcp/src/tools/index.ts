/** The complete tool list, in the order clients show it. */
import type { Tool } from "../registry.js";
import type { TradeApiClient } from "../trade/client.js";
import { adviceTools, atlasTools } from "./advice.js";
import { characterTools } from "./character.js";
import { editTools } from "./edit.js";
import { guideTools } from "./guides.js";
import { knowledgeTools } from "./knowledge.js";
import { optimiseTools } from "./optimise.js";
import { readTools } from "./read.js";
import { profileTools, sessionTools } from "./session.js";
import { checkLeague, tradeTools } from "./trade.js";

export function allTools(trade: TradeApiClient): Tool[] {
  const trades = tradeTools();
  return [
    ...profileTools((league) => checkLeague(trade, league)),
    ...sessionTools,
    ...characterTools(),
    ...readTools,
    ...editTools,
    ...adviceTools,
    ...optimiseTools(trades.find((t) => t.name === "plan_upgrades")),
    ...guideTools,
    ...trades,
    ...atlasTools,
    ...knowledgeTools(),
  ];
}
