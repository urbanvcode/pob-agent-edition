-- Clicks on the AI's marks reach the marks first on every tab (0.9.5 bug: on the Items
-- tab a tour box over the item list could not be clicked: Next, Back and dismiss did nothing,
-- because the tab's controls took the click first). Runs PoB's real build frame
-- (buildMode:OnFrame) with a simulated mouse in the headless engine.
-- Run with the working directory set to PathOfBuilding/src:
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
main.screenW, main.screenH = main.screenW or 1920, main.screenH or 1080

local cursorX, cursorY = 0, 0
GetCursorPos = function() return cursorX, cursorY end

-- One frame of the build screen with these input events; returns the events left over.
local function frame(events)
	events = events or { }
	local ok, err = pcall(build.OnFrame, build, events)
	check(ok, "build frame: " .. tostring(err))
	return events
end
local function hit(name)
	for _, h in ipairs(build.agentMarksHits or { }) do if h.name == name then return h end end
end
-- Click the centre of a named area; true when both the press and the release were taken.
local function click(name)
	local h = hit(name)
	if not h then return false, "no " .. name .. " area on " .. tostring(build.viewMode) end
	cursorX, cursorY = h.r.x + h.r.w / 2, h.r.y + h.r.h / 2
	local events = { { type = "KeyDown", key = "LEFTBUTTON" }, { type = "KeyUp", key = "LEFTBUTTON" } }
	frame(events)
	return events[1] == nil and events[2] == nil
end

-- A tour of 4 steps, step 2 on the Items tab on a flask slot (as the player had it).
local tour = { { target = "Helmet" }, { target = "Flask 2" }, { target = "Vortex", kind = "gem" }, { target = "Is the enemy Shocked?", kind = "config" } }
handlers.point_marks({ marks = tour, tour = true })
handlers.point_step({ delta = 1 })
check(build.viewMode == "ITEMS" and build.agentTour.step == 2, "tour on step 2 (Flask 2, Items tab)")
frame()
local taken, why = click("next")
check(taken, "Items tab: Next takes the click: " .. tostring(why))
check(build.agentTour and build.agentTour.step == 3 and build.viewMode == "SKILLS", "Items tab: Next goes to step 3")
frame()
taken, why = click("back")
check(taken and build.agentTour.step == 2 and build.viewMode == "ITEMS", "Skills tab: Back goes to step 2: " .. tostring(why))
frame()
handlers.point_step({ delta = 2 })
check(build.viewMode == "CONFIG", "step 4 on Configuration")
frame()
taken, why = click("back")
check(taken and build.agentTour.step == 3, "Configuration tab: Back: " .. tostring(why))
frame()
taken, why = click("box")
check(taken and build.agentMarks == nil, "clicking the box closes the tour: " .. tostring(why))

-- Single marks: dismissing one by its box, on Items, Skills and Configuration.
for _, case in ipairs({ { "Flask 2", nil, "ITEMS" }, { "Vortex", "gem", "SKILLS" }, { "Is the enemy Shocked?", "config", "CONFIG" } }) do
	handlers.point_marks({ marks = { { target = case[1], kind = case[2] }, { target = "Helmet" } } })
	build.viewMode = case[3]
	frame()
	local before = #build.agentMarks
	taken, why = click("box")
	check(taken and build.agentMarks and #build.agentMarks == before - 1, case[3] .. ": a click on the box dismisses the mark: " .. tostring(why))
end

-- "Clear AI marks" works on every tab, the tree included.
for _, view in ipairs({ "ITEMS", "SKILLS", "CONFIG", "CALCS", "TREE" }) do
	handlers.point_marks({ marks = { { target = "Helmet" }, { target = "Ash, Frost and Storm" } } })
	build.viewMode = view
	frame()
	taken, why = click("clear")
	check(taken and build.agentMarks == nil, view .. ": Clear AI marks: " .. tostring(why))
end

-- On the tree: Next on a tour step's box (the tree must not take the click).
handlers.point_marks({ marks = { { target = "Ash, Frost and Storm" }, { target = "Helmet" } }, tour = true })
build.viewMode = "TREE"
frame()
local allocBefore = build.spec.allocNodes[45317]
taken, why = click("next")
check(taken and build.agentTour and build.agentTour.step == 2, "Tree: Next takes the click: " .. tostring(why))
check(build.spec.allocNodes[45317] == allocBefore, "the click did not reach the tree")

-- Esc closes the tour; Esc without marks is left alone.
frame()
local events = { { type = "KeyDown", key = "ESCAPE" } }
frame(events)
check(build.agentMarks == nil and events[1] == nil, "Esc closes the tour")
events = { { type = "KeyDown", key = "ESCAPE" } }
frame(events)
check(events[1] ~= nil, "Esc without marks goes to PoB as before")

-- A click elsewhere still reaches the tab.
handlers.point_marks({ marks = { { target = "Helmet" } } })
build.viewMode = "ITEMS"
frame()
cursorX, cursorY = 5, 5
events = { { type = "KeyDown", key = "LEFTBUTTON" }, { type = "KeyUp", key = "LEFTBUTTON" } }
build.agentMarksModule.HandleInput(build, events)
check(events[1] ~= nil and events[2] ~= nil and build.agentMarks ~= nil, "the marks leave a click elsewhere to PoB")

print = io.write
if failures > 0 then os.exit(1) end
print("marks input ok: " .. checks .. " checks\n")
