-- Headless test of the Overview Levelling card (PathOfBuilding/src/Agent/LevellingCard.lua):
-- its own code with the global `build` unset (as in the window between AI requests),
-- with and without a guide picked in the Guide tab, and hidden from level 90.
-- Run with the working directory set to PathOfBuilding/src:
--   luajit <this file> <player build xml> <guide build xml> <temp dir>
local playerFile, guideFile, tmp = arg[1], arg[2], arg[3]

print = function(...) end -- PoB's console output is not needed
dofile("HeadlessWrapper.lua")

local function fail(msg)
	io.stderr:write("FAIL: " .. tostring(msg) .. "\n")
	os.exit(1)
end
local function read(path)
	local f = assert(io.open(path, "rb"))
	local s = f:read("*a")
	f:close()
	return s
end

local DIR = "Agent/Handlers/"
local handlers = loadfile(DIR .. "Core.lua")(DIR)
launch.agentServer = { handlers = handlers }
main.userPath = tmp .. "/"
main.buildPath = tmp .. "/Builds/"
os.execute('mkdir "' .. (tmp .. "/Builds"):gsub("/", "\\") .. '" 2>nul')
function MakeDir(path) os.execute('mkdir "' .. path:gsub("[/\\]+$", ""):gsub("/", "\\") .. '" 2>nul') end
local f = assert(io.open(main.buildPath .. "Guide - Test.xml", "wb"))
f:write(read(guideFile))
f:close()
function NewFileSearch(pattern)
	if not pattern:find("Guide %- %*%.xml$") then return nil end
	return { GetFileName = function() return "Guide - Test.xml" end, GetFileModifiedTime = function() return 1 end, NextFile = function() return false end }
end

local loaded = handlers.load_build_xml({ xml = read(playerFile), name = "Player" })
if not loaded or not loaded.ok then fail("could not load the player build: " .. tostring(loaded and loaded.error)) end
-- A level-34 character: the first 40 points of the tree, no ascendancy points.
local own = handlers.levelling_guide_stages({ ids = true })
local drop, asc = { }, { }
for i = #own.stages[1].walk, 41, -1 do table.insert(drop, own.stages[1].walk[i]) end
for i = #own.stages[1].ascIds, 1, -1 do table.insert(asc, own.stages[1].ascIds[i]) end
local edit = handlers.edit({ ops = { { op = "dealloc", nodes = drop }, { op = "dealloc", nodes = asc }, { op = "config", values = { level = 34, resistancePenalty = 0 } } } })
if not edit.ok then fail("could not set level 34: " .. tostring(edit.error)) end
local playerBuild = build
build = nil

local LevellingCard = LoadModule("Agent/LevellingCard")
if not LevellingCard.show(playerBuild) then fail("the card should show below level 90") end

-- A stand-in for the Overview tab: the card only uses Card, Hot and IsHot.
local hots = 0
local tab = { build = playerBuild,
	Card = function(self, id, x, y, w, h) return x + 12, y + 30, w - 24, h - 40 end,
	Hot = function() hots = hots + 1 end, IsHot = function() return false end }

-- No guide tab: planned from the build itself.
local ok, err = pcall(LevellingCard.draw, tab, 0, 0, 400, LevellingCard.height)
if not ok then fail("draw crashed: " .. tostring(err)) end
if build ~= nil then fail("the global build was left set") end
local data = LevellingCard.data(playerBuild)
if not data or not data.ok then fail("no card data: " .. tostring(data and data.error)) end
if data.from ~= "build" then fail("expected a plan from the build, got " .. tostring(data.from)) end
if data.me.level ~= 34 then fail("level " .. tostring(data.me.level)) end
if #data.next == 0 then fail("no next steps") end
if hots < 2 then fail("the card registered no tooltips") end

-- A guide picked in the Guide tab: the card follows it.
playerBuild.guideTab = new("GuideTab", playerBuild)
local okG, errG = pcall(function() playerBuild.guideTab:ScanGuides() end)
if not okG then fail("guide scan crashed: " .. tostring(errG)) end
playerBuild.characterLevel = 35 -- a change, so the card recomputes
local okD, errD = pcall(LevellingCard.draw, tab, 0, 0, 400, LevellingCard.height)
if not okD then fail("draw with a guide crashed: " .. tostring(errD)) end
if build ~= nil then fail("the global build was left set (guide)") end
local withGuide = LevellingCard.data(playerBuild, true)
if not withGuide or withGuide.from ~= "guide" then fail("the card did not follow the Guide tab's guide: " .. tostring(withGuide and withGuide.from)) end

-- Hidden from level 90.
playerBuild.characterLevel = 90
if LevellingCard.show(playerBuild) then fail("the card should hide at level 90") end

print = io.write
print("levellingcard ok: " .. #data.next .. " steps, act " .. tostring(data.me.act) .. ", guide " .. tostring(withGuide.guideName) .. "\n")
