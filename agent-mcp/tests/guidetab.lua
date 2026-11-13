-- Regression test for the Guide tab (PathOfBuilding/src/Classes/GuideTab.lua) in the
-- headless engine. The agent handlers work on the global `build`, which the AI link
-- only sets while it answers a request; a player who opens the Guide tab without any
-- AI request had it nil (0.6.1 crashed in Guide.lua stageList). This runs the tab's
-- own code with the global set to nil: stage list, Auto detection, Analyse.
-- Run with the working directory set to PathOfBuilding/src:
--   luajit <this file> <player build xml> <guide build xml> <temp dir>
local playerFile, guideFile, tmp = arg[1], arg[2], arg[3]
local dkjson = require("dkjson")

print = function(...) end -- PoB's console output is not needed
dofile("HeadlessWrapper.lua")

-- A real Inflate (HeadlessWrapper's stub would empty the timeless jewel caches).
do
	local ffi = require("ffi")
	ffi.cdef[[ int uncompress(uint8_t *dest, unsigned long *destLen, const uint8_t *source, unsigned long sourceLen); ]]
	local zlib
	for _, name in ipairs({ "../runtime/zlib1.dll", "zlib1", "z", "libz.so.1", "libz.dylib" }) do
		local loaded, lib = pcall(ffi.load, name)
		if loaded then zlib = lib break end
	end
	assert(zlib, "zlib not found")
	function Inflate(data)
		if not data or #data == 0 then return "" end
		local size = math.max(#data * 4, 65536)
		while size <= 1024 * 1024 * 1024 do
			local buf = ffi.new("uint8_t[?]", size)
			local len = ffi.new("unsigned long[1]", size)
			local rc = zlib.uncompress(buf, len, data, #data)
			if rc == 0 then return ffi.string(buf, len[0]) end
			if rc ~= -5 then return "" end
			size = size * 2
		end
		return ""
	end
end

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
-- Like PoB's MakeDir: one level only, the parent must exist (a fresh install has no AgentCache).
function MakeDir(path)
	local clean = path:gsub("[/\\]+$", "")
	local parent = clean:match("^(.*)[/\\][^/\\]+$")
	if parent and not os.rename(parent, parent) then return end
	os.execute('mkdir "' .. clean:gsub("/", "\\") .. '" 2>nul')
end

-- The guide sits in the Builds folder as "Guide - Test.xml" (several loadouts).
local f = assert(io.open(main.buildPath .. "Guide - Test.xml", "wb"))
f:write(read(guideFile))
f:close()
-- HeadlessWrapper has no file search: list the one guide.
function NewFileSearch(pattern)
	if not pattern:find("Guide %- %*%.xml$") then return nil end
	return { GetFileName = function() return "Guide - Test.xml" end, GetFileModifiedTime = function() return 1 end, NextFile = function() return false end }
end

-- The player's build, opened the way the window has it; then the global is cleared,
-- as it is in the window when no AI request has run.
local loaded = handlers.load_build_xml({ xml = read(playerFile), name = "Player" })
if not loaded or not loaded.ok then fail("could not load the player build: " .. tostring(loaded and loaded.error)) end
local playerBuild = build
build = nil

local tab = new("GuideTab", playerBuild)
local ok, err = pcall(function()
	tab:ScanGuides()
	tab:RefreshStages()
end)
if not ok then fail("stage list crashed with the global build unset: " .. tostring(err)) end
if build ~= nil then fail("the global build was left set") end
if not tab.stages or #tab.stages < 2 then fail("expected several stages, got " .. tostring(tab.stages and #tab.stages)) end
if not tab.detected or not tab.detected.index then fail("Auto stage detection did not run") end
if not tostring(tab.controls.stageSelect.list[1]):find("^Auto %(closest: ") then fail("stage list has no Auto entry: " .. tostring(tab.controls.stageSelect.list[1])) end

-- Analyse (the button runs this on the next frame).
local okA, errA = pcall(tab.Analyse, tab)
if not okA then fail("Analyse crashed: " .. tostring(errA)) end
if build ~= nil then fail("the global build was left set after Analyse") end
if not tab.result or not tab.result.ok then fail("Analyse gave no result: " .. tostring(tab.message)) end
if not tab.result.focus or not tab.result.plan then fail("Analyse result has no focus or plan") end
local card = dkjson.decode(read(tmp .. "/AgentCache/guide/card.json"))
if not card or card.build ~= playerBuild.buildName then fail("card.json not written for the player's build") end
-- Hide/Show panel: the tree gets the whole width, and the choice survives a restart.
if tab:PanelWidth() <= 0 then fail("the panel should be shown by default") end
tab:SetPanelHidden(true)
if tab:PanelWidth() ~= 0 then fail("hidden panel still takes width") end
local settings = dkjson.decode(read(tmp .. "/AgentEdition.json"))
if not settings or settings.guideHelpHidden ~= true then fail("guideHelpHidden not saved in AgentEdition.json") end
local again = new("GuideTab", playerBuild)
if again:PanelWidth() ~= 0 then fail("the hidden panel was not remembered") end
again:SetPanelHidden(false)
if new("GuideTab", playerBuild):PanelWidth() <= 0 then fail("Show panel was not remembered") end
print = io.write
print("guidetab ok: " .. #tab.stages .. " stages, detected " .. tostring(tab.detected.index) .. ", focus " .. tostring(tab.result.focus.title) .. "\n")
