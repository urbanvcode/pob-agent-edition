-- "Point at it" marks (Agent/Marks.lua, Agent/Handlers/Point.lua) in the headless engine:
-- every target type resolves by name, is stored as a numbered mark, drawn without errors,
-- dismissed and cleared. Run with the working directory set to PathOfBuilding/src:
--   luajit <this file> <build xml>
local buildFile = arg[1]

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
check(r.ok and m and m.kind == "node" and m.view == "TREE" and m.points and m.points >= 1 and m.text == "take this next", "free notable: " .. tostring(m and m.line))
check(build.viewMode == "TREE" and build.agentMarks and #build.agentMarks == 1 and build.agentMarks[1].path, "stored with its path, Tree tab shown")
check(m.line:match("^1%. Ash, Frost and Storm %(node, passive tree, %d+ points? from your tree%): take this next$"), "line: " .. m.line)
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
-- dry: resolve only (the "window not open" answer); nothing stored.
r = point({ "Ash, Frost and Storm" }, true)
check(#r.marks == 1 and r.stored == 0 and build.agentMarks == nil, "dry run stores nothing")
-- Never saved into the build.
point({ "Helmet" })
check(not handlers.export_build_xml({ }).xml:find("agentMarks", 1, true), "marks are not saved")

print = io.write
if failures > 0 then os.exit(1) end
print("point ok: " .. checks .. " checks\n")
