// Live smoke test: the AGENTS.md workflows against a running PoB Agent Edition window.
//
//   $env:POB_AGENT_PORT = "31338"; npm run test:live      (use a second PoB instance, not the player's)
//
// It only reads the open build and runs what_if (which rolls back): it never saves, never opens
// another build, never writes the profile and makes no trade requests unless TRADE=1 is set.
import assert from "node:assert/strict";

process.env.POB_LIVE = "only";
const { createTools, runTool } = await import("../build/server.js");
const { tools, context } = createTools();

let failed = 0;
async function step(name, args, check) {
  const r = await runTool(tools, context, name, args ?? {});
  try {
    assert.equal(r.isError, false, r.text);
    check?.(r.text);
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message.split("\n")[0]}`);
  }
  return r.text;
}

const status = await step("status", {}, (t) => assert.match(t, /Mode: live PoB Agent Edition window/));
if (!/Build: /.test(status)) {
  console.log("Open a build in the PoB window first, then run this again.");
  process.exit(1);
}
await step("profile", {}, (t) => assert.match(t, /How to answer/));
await step("build_summary", {}, (t) => assert.match(t, /SKILLS[\s\S]*ITEMS[\s\S]*TREE[\s\S]*Config assumptions:/));
const before = await step("stats", {}, (t) => assert.match(t, /Config assumptions:/));
await step("diagnose", {}, (t) => assert.match(t, /1\. RESISTANCES[\s\S]*2\. SURVIVABILITY[\s\S]*3\. RECOVERY AND MANA[\s\S]*4\. DAMAGE/));
await step("what_if", { ops: [{ op: "config", values: { enemyIsBoss: "Uber" } }, { op: "flask", index: 1, active: false }] },
  (t) => assert.match(t, /Rolled back: the build is as it was\./));
await step("stats", {}, (t) => assert.equal(t, before, "what_if changed the build"));
await step("status", {}, (t) => assert.equal(/UNSAVED/.test(t), /UNSAVED/.test(status), "what_if changed the unsaved flag"));
await step("tree_search", { query: "life", limit: 3 }, (t) => assert.match(t, /^\d+ /m));
await step("suggest", { kind: "passives", points: 2, limit: 3 });
await step("atlas", {}, (t) => assert.match(t, /Atlas tree/));
await step("atlas", { query: "essence", limit: 3 });
{
  // Saving without a name must never overwrite the player's file.
  const r = await runTool(tools, context, "save_build", {});
  const refused = r.isError && /would overwrite the player's file|no file yet/.test(r.text);
  if (!refused) failed++;
  console.log(`${refused ? "ok  " : "FAIL"} save_build without a name is refused`);
}
if (process.env.TRADE === "1") {
  await step("prices", { leagues: true }, (t) => assert.match(t, /Standard/));
  await step("plan_upgrades", { slots: ["Ring 1"], budget_chaos: 20, max_results: 3 }, (t) => assert.match(t, /instant buyout only/));
}

context.pob.close();
console.log(failed ? `${failed} step(s) failed.` : "Live smoke test passed.");
process.exit(failed ? 1 : 0);
