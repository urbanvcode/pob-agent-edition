-- "Point at it" marks (Agent/Marks.lua, Agent/Handlers/Point.lua) in the headless engine:
-- every target type resolves by name, is stored as a numbered mark, drawn without errors,
-- dismissed and cleared. Run with the working directory set to PathOfBuilding/src:
--   luajit <this file> <build xml> <temp dir>
local buildFile, tmp = arg[1], arg[2]

print = function(...) end
dofile("HeadlessWrapper.lua")

local failures, checks = 0, 0
local function check(cond, msg)
	checks = checks + 1
	if not cond then failures = failures + 1 io.stderr:write("FAIL: " .. tostring(msg) .. "\n") end
end
local function read(path)
	local f = assert(io.open(path, "rb"))
	local s = f:read("*a")
	f:close()
	return s
end

main.userPath = tmp .. "/"
local DIR = "Agent/Handlers/"
local handlers = loadfile(DIR .. "Core.lua")(DIR)
local loaded = handlers.load_build_xml({ xml = read(buildFile), name = "Test" })
assert(loaded and loaded.ok, "could not load the build")

local function point(marks, dry) return handlers.point_marks({ marks = marks, dry = dry }) end
local function one(target, kind, text)
	local r = point({ { target = target, kind = kind, text = text } })
	return r, r.marks and r.marks[1]
end

-- Tree: a free notable (with its path), an allocated keystone, by id.
local r, m = one("Ash, Frost and Storm", nil, "take this next")
check(r.ok and m and m.kind == "node" and m.view == "TREE" and m.points and m.points >= 1 and m.text == "take this next", "free notable: " .. tostring(m and m.text_line))
check(build.viewMode == "TREE" and build.agentMarks and #build.agentMarks == 1 and build.agentMarks[1].path, "stored with its path, Tree tab shown")
check(m.text_line:match("^1%. Ash, Frost and Storm %(node, passive tree, %d+ points? from your tree%): take this next$"), "line: " .. m.text_line)
r, m = one("Elemental Overload")
check(m and m.kind == "node" and m.allocated and m.where == "allocated", "allocated keystone")
r, m = one("22088", "node")
check(m and m.label == "Elemental Overload", "node by id")
-- Items: a slot, an item by name, a flask.
r, m = one("Helmet")
check(m and m.kind == "slot" and m.view == "ITEMS" and m.label:find("^Helmet: Heretic's Veil"), "slot: " .. tostring(m and m.label))
r, m = one("Heretic's Veil", "slot")
check(m and m.slot == "Helmet", "item by name")
r, m = one("flask 2")
check(m and m.kind == "flask" and m.slot == "Flask 2", "flask")
-- Skills: a gem, a group.
r, m = one("Vortex", "gem")
check(m and m.kind == "gem" and m.view == "SKILLS" and m.group and m.gem, "gem: " .. tostring(m and m.label))
r, m = one("group 1", "gem")
check(m and m.group == 1, "group by number")
-- Configuration and Calcs.
r, m = one("Is the enemy Shocked?", "config")
check(m and m.kind == "config" and m.view == "CONFIG" and m.var, "config option: " .. tostring(m and m.label))
r, m = one("Crit Chance", "calcs")
check(m and m.kind == "calcs" and m.view == "CALCS", "calcs row: " .. tostring(m and m.label))
-- Several at once, numbered; one unknown; drawing every tab; dismiss; clear.
r = point({ { target = "Helmet", text = "1. click here" }, { target = "Vortex", kind = "gem" }, "Ash, Frost and Storm", { target = "zzzz nothing" } })
check(#r.marks == 3 and r.marks[1].n == 1 and r.marks[3].n == 3 and r.errors and r.errors[1]:find("zzzz"), "numbered marks, unknown reported")
check(build.viewMode == "ITEMS", "the first mark's tab is shown")
local Marks = build.agentMarksModule
local vp = { x = 312, y = 32, width = 1200, height = 800 }
for _, view in ipairs({ "ITEMS", "SKILLS", "CONFIG", "CALCS", "TREE" }) do
	build.viewMode = view
	local ok, err = pcall(Marks.Draw, build, vp, { })
	check(ok, "draw marks on " .. view .. ": " .. tostring(err))
end
local okT, errT = pcall(Marks.DrawTree, build, build.spec, function(x, y) return x * 0.1 + 600, y * 0.1 + 400 end, 0.1, vp, { })
check(okT, "draw marks on the tree: " .. tostring(errT))
Marks.Dismiss(build, build.agentMarks[2])
check(#handlers.point_state().marks == 2, "dismiss one")
r = point({ })
check(r.cleared and build.agentMarks == nil and #handlers.point_state().marks == 0, "cleared")

-- Styles and meanings are stored; unknown ones are dropped.
r, m = one("Helmet", nil, nil)
r = point({ { target = "Helmet", style = "glow", tone = "problem" }, { target = "Vortex", kind = "gem", style = "sparkle", tone = "info" } })
check(r.marks[1].style == "glow" and r.marks[1].tone == "problem" and r.marks[2].style == nil and r.marks[2].tone == "info", "style and tone stored")
check(build.agentMarks[1].style == "glow", "style kept on the stored mark")
-- Guided tour: one step at a time, Next / Back move through the tabs.
r = handlers.point_marks({ marks = { { target = "Helmet" }, { target = "Vortex", kind = "gem" }, { target = "Ash, Frost and Storm" } }, tour = true })
check(r.tour == 3 and build.agentTour and build.agentTour.step == 1 and build.viewMode == "ITEMS", "tour starts at step 1")
check(#build.agentMarksModule.Visible(build) == 1, "a tour shows one step")
local st = handlers.point_step({ delta = 1 })
check(st.ok and st.step == 2 and build.viewMode == "SKILLS", "Next goes to step 2 on the Skills tab")
st = handlers.point_step({ delta = 1 })
check(st.step == 3 and build.viewMode == "TREE", "step 3 on the tree")
st = handlers.point_step({ delta = -1 })
check(st.step == 2 and handlers.point_state().step == 2, "Back")
-- The route to a node: numbered nearest-first.
r, m = one("Ash, Frost and Storm")
local okOrder = m.path and #m.path >= 1
for i = 2, #(m.path or { }) do
	if (build.spec.nodes[m.path[i]].pathDist or 0) < (build.spec.nodes[m.path[i - 1]].pathDist or 0) then okOrder = false end
end
check(okOrder and m.path[#m.path] == m.node, "path numbered from the tree to the node")
-- An item's mod line.
r, m = one("Helmet", "slot")
r = point({ { target = "Helmet", line = "Blasphemy" } })
m = r.marks[1]
check(m and m.line == "Socketed Gems are Supported by Level 22 Blasphemy", "mod line: " .. tostring(m and m.line))
local lines = build.agentMarksModule.BoxLines(build, build.agentMarks[1])
local boxText = { }
for _, l in ipairs(lines) do table.insert(boxText, l.text) end
check(table.concat(boxText, "\n"):find("> Socketed Gems are Supported by Level 22 Blasphemy", 1, true), "the line is highlighted in the box")
r = point({ { target = "Helmet", line = "zzz" } })
check(#r.marks == 0 and r.errors and r.errors[1]:find('no line "zzz"'), "missing line reported")
-- A candidate item: what it replaces and the stats that change, simulated and rolled back.
local before = handlers.key_stats({ }).stats
r = point({ { target = "Helmet", candidate = "Rarity: RARE\nTest Crown\nHubris Circlet\n+90 to maximum Life\n+40% to Fire Resistance" } })
m = r.marks[1]
check(m and m.candidate and m.candidate.replaces:find("Heretic's Veil", 1, true), "candidate replaces the helmet")
local lifeLine
for _, d in ipairs(m and m.candidate and m.candidate.deltas or { }) do if d.text:find("^Life:") then lifeLine = d end end
check(lifeLine and lifeLine.good, "candidate life change shown in green")
check(handlers.key_stats({ }).stats.Life == before.Life, "the build is unchanged after the candidate")
-- Gems: swap this for that, socket colours, move to a socket.
r = point({ { target = "Vortex", kind = "gem", to = "Cold Snap", to_slot = "Gloves" } })
m = r.marks[1]
check(m and m.socket == "blue" and m.to == "Cold Snap" and m.toSocket == "blue" and m.toSlot == "Gloves", "gem swap and sockets: " .. tostring(m and m.text_line))
-- Gain tag from PoB.
r = point({ { target = "Ash, Frost and Storm", ops = { { op = "alloc", nodes = { 45317 } } } } })
m = r.marks[1]
check(m and m.gain and m.gain.dpsPct > 5 and m.gain.tag:match("^%+6%.%d%% DPS"), "gain tag: " .. tostring(m and m.gain and m.gain.tag))
check(not build.spec.allocNodes[45317], "the gain was simulated and rolled back")
-- History: show again.
local hist = handlers.point_state().history
check(#hist >= 5 and hist[1].title:find("Ash, Frost and Storm", 1, true), "history kept, latest first")
r = handlers.point_marks({ again = 2 })
check(r.ok and r.marks[1].kind == "gem" and r.marks[1].to == "Cold Snap", "show again replays an earlier set")
check(#handlers.point_state().history == #hist, "replaying adds no history")
build.agentMarksModule.Clear(build)
local okA, errA = pcall(build.agentMarksModule.DrawAgain, build, vp, { })
check(okA, "Show again button draws: " .. tostring(errA))
-- Chat link click points at it.
local okC, ChatPanel = pcall(LoadModule, "Agent/ChatPanel")
check(okC and ChatPanel and ChatPanel._openLink, "chat panel loads: " .. tostring(ChatPanel))
if okC and ChatPanel and ChatPanel._openLink then
	ChatPanel._openLink(build, "node", "Ash, Frost and Storm")
	check(build.agentMarks and build.agentMarks[1].label == "Ash, Frost and Storm" and build.agentMarks[1].tone == "info" and build.viewMode == "TREE", "a [[node:...]] click marks the node")
	ChatPanel._openLink(build, "gem", "Vortex")
	check(build.agentMarks and build.agentMarks[1].kind == "gem", "a [[gem:...]] click marks the gem")
end
-- Reduced motion: stored in AgentEdition.json, no pulsing, no glide.
local Marks = build.agentMarksModule
Marks.SetReducedMotion(true)
check(read(tmp .. "/AgentEdition.json"):find('"marksReducedMotion":true', 1, true), "reduced motion saved")
check(Marks.Pulse("ring") == 1 and Marks.Pulse("outline") == 1 and Marks.Pulse("glow") == 1, "no pulsing or blinking")
build.treeTab.viewer:CentreOn(100, 100, vp, build)
check(build.treeTab.viewer.glide == nil, "no zoom animation")
check(handlers.point_state().reducedMotion == true, "state reports reduced motion")
Marks.SetReducedMotion(false)
build.treeTab.viewer:CentreOn(200, 200, vp, build)
check(build.treeTab.viewer.glide ~= nil, "zoom glides when motion is on")
check(Marks.TONES["do"][4] == "^x009E73" and Marks.TONES.problem[4] == "^xD55E00" and Marks.TONES.info[4] == "^x56B4E9", "colour-blind-friendly palette")

-- dry: resolve only (the "window not open" answer); nothing stored.
r = point({ "Ash, Frost and Storm" }, true)
check(#r.marks == 1 and r.stored == 0 and build.agentMarks == nil, "dry run stores nothing")
-- Never saved into the build.
point({ "Helmet" })
check(not handlers.export_build_xml({ }).xml:find("agentMarks", 1, true), "marks are not saved")

print = io.write
if failures > 0 then os.exit(1) end
print("point ok: " .. checks .. " checks\n")
