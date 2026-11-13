-- Offline test of PoB's in-window character sync (PathOfBuilding/src/Agent/CharacterSync.lua).
-- PoB's downloader, file search and the import handler are replaced by fakes; the
-- pathofexile.com answers are agent-mcp's character fixtures. No network, no window.
-- Run (from agent-mcp, see tests/guide.test.mjs): luajit tests/charsync.lua <src dir> <fixtures dir> <temp dir>
local src, fixtures, tmp = arg[1], arg[2], arg[3]
package.path = src .. "/../runtime/lua/?.lua;" .. src .. "/../runtime/lua/?/init.lua;" .. package.path
local dkjson = require("dkjson")

local function read(path)
	local f = assert(io.open(path, "rb"))
	local s = f:read("*a")
	f:close()
	return s
end

-- Fakes for PoB's globals --------------------------------------------------------------
local clock = 0
function GetTime() return clock end
function MakeDir(path) os.execute('mkdir "' .. path:gsub("/", "\\") .. '" 2>nul') end
function NewFileSearch() return nil end
common = { sha1 = require("sha1") }
main = { userPath = tmp .. "/" }
function LoadModule(name)
	if name == "Agent/Settings" then
		return { get = function() return nil end, set = function() return true end }
	end
	return dofile(src .. "/" .. name .. ".lua")
end

local requests = {}
local answers = {
	["get-characters"] = read(fixtures .. "/characters.json"),
	["get-items"] = read(fixtures .. "/items.json"),
	["get-passive-skills"] = read(fixtures .. "/passives.json"),
}
local pending
launch = {
	DownloadPage = function(_, url, cb)
		table.insert(requests, { url = url, at = clock })
		local kind = url:match("character%-window/([%w%-]+)")
		pending = function() cb({ body = answers[kind], header = "" }, nil) end
	end,
}
local imported
launch.agentServer = { handlers = {
	character_import = function(params)
		-- PoB's handlers work on the global build: the sync must set it (0.6.1 did not).
		if build == nil or build.buildName ~= params.name then error("character_import ran without the build set") end
		imported = params
		return { ok = true, state = { level = params.character.level, className = params.character.class, stats = { CombinedDPS = 1000, TotalEHP = 5000, Life = 3000 },
			items = { { slot = "Helmet", name = "Test Helm", mods = "abc" } }, gems = { { name = "Frenzy", level = 20, quality = 0 } }, nodes = { 1, 2, 3 }, named = {} } }
	end,
	export_build_xml = function() return { ok = true, xml = "<PathOfBuilding/>" } end,
} }

-- The character to sync: the first one in the fixture list.
local chars = dkjson.decode(answers["get-characters"])
local char = chars[1]
os.execute('mkdir "' .. (tmp .. "/AgentCache/history"):gsub("/", "\\") .. '" 2>nul')
local f = assert(io.open(tmp .. "/AgentCache/history/index.json", "w"))
f:write(dkjson.encode({ last = { account = "Tester#1234", realm = "pc", character = char.name } }))
f:close()

local Sync = dofile(src .. "/Agent/CharacterSync.lua")
local playerBuild = { buildName = char.name .. " - synced", importTab = {}, modFlag = false }
build = nil -- as in the window when no AI request has run
local function wrap(other, fn, ...)
	local saved = build
	build = other
	local ok, res = pcall(fn, ...)
	build = saved
	if not ok then return { ok = false, error = tostring(res) } end
	return res
end
launch.agentServer.handlers._withBuild = wrap
local build = playerBuild

local function fail(msg) io.stderr:write("FAIL: " .. msg .. "\n") os.exit(1) end

-- Wrong build is refused before any request.
local ok, why = Sync.check({ buildName = "Something else", importTab = {} })
if ok or not tostring(why):find("Open") then fail("a different build must be refused: " .. tostring(why)) end

Sync.start(build, false)
if not Sync.busy then fail("sync did not start: " .. tostring(Sync.status)) end
-- Drive frames: requests must be at least 2 s apart.
for step = 1, 200 do
	clock = clock + 100
	Sync.tick(nil)
	if pending then local p = pending pending = nil p() end
	if not Sync.busy then break end
end
if Sync.busy or not Sync.ok then fail("sync did not finish: " .. tostring(Sync.status)) end
if #requests ~= 3 then fail("expected 3 requests, got " .. #requests) end
for i = 2, #requests do
	if requests[i].at - requests[i - 1].at < 2000 then fail("requests closer than 2 s") end
end
if not requests[1].url:find("accountName=Tester%%23") then fail("account not url-encoded: " .. requests[1].url) end
if not imported or imported.character.name ~= char.name or type(imported.items) ~= "table" or type(imported.passives) ~= "table" then fail("import got the wrong data") end

local index = dkjson.decode(read(tmp .. "/AgentCache/history/index.json"))
local entry = index.characters[common.sha1(char.name)]
if not entry or #entry.timeline ~= 1 or entry.timeline[1].summary ~= "first sync" then fail("index timeline not written") end
local hist = dkjson.decode(read(tmp .. "/AgentCache/history/pc_Tester_1234_" .. char.name:gsub("[^%w%._%-]+", "_") .. ".json"))
if #hist.entries ~= 1 or hist.entries[1].characterHash ~= nil then fail("history entry wrong") end

-- A second sync within a minute is refused without a request.
Sync.start(build, false)
if Sync.busy or #requests ~= 3 or not tostring(Sync.status):find("less than a minute") then fail("resync within a minute must be refused") end

-- 429: a pause, no further requests.
Sync.lastAt = 0
launch.DownloadPage = function(_, url, cb)
	table.insert(requests, { url = url, at = clock })
	pending = function() cb({ body = "", header = "" }, "Response code: 429") end
end
Sync.start(build, false)
for step = 1, 50 do
	clock = clock + 100
	Sync.tick(nil)
	if pending then local p = pending pending = nil p() end
	if not Sync.busy then break end
end
if Sync.ok ~= false or Sync.blockedUntil <= os.time() then fail("429 must pause syncing") end
Sync.start(build, false)
if Sync.busy then fail("sync started during the pause") end
print("charsync ok")
