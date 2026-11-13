/** Levelling coach (Stage 7): reached through guide { levelling: "next" | "plan" }. Read-only. */
import { levellingPlan, nextText, planText } from "../levelling.js";
import { S, tool, type Tool } from "../registry.js";

export const levellingTools: Tool[] = [
  tool("guide_levelling", "Levelling coach: where the character stands and the next steps, or the act-by-act plan.",
    { levelling: S.enum(["next", "plan"]), guide: S.str(), level: S.num(), act: S.num() }, [],
    async ({ pob }, args) => {
      const plan = args.levelling === "plan";
      const p = await levellingPlan(pob, { plan, guide: args.guide, level: Number(args.level) || undefined, act: Number(args.act) || undefined });
      return plan ? planText(p) : nextText(p);
    }),
];
