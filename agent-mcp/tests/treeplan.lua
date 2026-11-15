-- Tree compare / respec planner in the headless engine: the parts only the PoB window
-- shows (gain colours and legend, hover lines, box text, order numbers, Apply into a new
-- tree, a pasted code) and the differences a fixture build cannot have (mastery effects,
-- cluster jewel nodes, jewels from another build, another class), on made-up trees.
-- Run with the working directory set to PathOfBuilding/src:
--   luajit <this file> <build xml> <file with a PoB code>
local buildFile, codeFile = arg[1], arg[2]

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
		local size = math.max(#data * 8, 65536)
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

local TreeDiff = LoadModule("Agent/TreeDiff")
local Panel = LoadModule("Agent/TreePlanPanel")

-- A. Made-up trees (pure TreeDiff) -------------------------------------------------------
local function fakeSpec(classId, ascId, alloc, masteries, jewels)
	local nodes = { }
	local function n(id, type, dn, group) nodes[id] = { id = id, type = type, dn = dn, group = group, linked = { } } end
	n(1, "ClassStart", "Start") n(2, "Normal", "Small A") n(3, "Notable", "Notable A", "g1") n(4, "Normal", "Small B")
	n(5, "Notable", "Notable B") n(10, "Notable", "Notable C") n(6, "Normal", "Small C") n(7, "Notable", "Notable D")
	n(11, "Notable", "Notable E") n(8, "Mastery", "Life Mastery", "g1") n(9, "Socket", "Jewel Socket") n(70000, "Notable", "Cluster Notable")
	local function link(a, b) table.insert(nodes[a].linked, nodes[b]) table.insert(nodes[b].linked, nodes[a]) end
	link(1, 2) link(2, 3) link(3, 4) link(4, 5) link(5, 10) link(1, 6) link(6, 7) link(7, 11) link(1, 9) link(9, 70000)
	local spec = { curClassId = classId, curAscendClassId = ascId, curClassName = "Class" .. classId, curAscendClassName = "Asc", nodes = nodes,
		allocNodes = { }, masterySelections = masteries or { }, jewels = jewels or { },
		tree = { masteryEffects = { [101] = { sd = { "+50 to maximum Life" } }, [102] = { sd = { "10% increased maximum Life" } } } } }
	for _, id in ipairs(alloc) do spec.allocNodes[id] = nodes[id] end
	return spec
end
local function item(title) return { title = title, BuildRaw = function() return title end } end
local baseBuild = { itemsTab = { items = { [1] = item("Cobalt Jewel A") } } }
local otherBuild = { itemsTab = { items = { [1] = item("Large Cluster Jewel B") } } }
local base = fakeSpec(3, 1, { 1, 2, 3, 8, 9, 6, 7, 11 }, { [8] = 101 }, { [9] = 1 })
local other = fakeSpec(3, 1, { 1, 2, 3, 4, 5, 10, 8, 9, 70000 }, { [8] = 102 }, { [9] = 1 })
local d = TreeDiff.diff(base, other, baseBuild, otherBuild)
local byId = { }
for _, c in ipairs(d.changes) do byId[c.id] = c end
check(byId["+5"] and byId["+10"] and byId["-7"] and byId["-11"], "adds and removes found")
check(byId["m8"] and byId["m8"].oldText == "+50 to maximum Life" and byId["m8"].newText == "10% increased maximum Life", "mastery effect change")
check(byId["j9"] and byId["j9"].oldJewel == "Cobalt Jewel A" and byId["j9"].newJewel == "Large Cluster Jewel B" and not byId["j9"].simulated, "jewel from another build: listed, not simulated")
check(byId["+70000"] and byId["+70000"].cluster, "cluster jewel node flagged")
check(TreeDiff.tag(byId["+70000"]) == "NEW (cluster)", "cluster tag: " .. TreeDiff.tag(byId["+70000"]))
-- Order: +10 scores best but needs +5 first; the removal further out (-11) comes before -7.
TreeDiff.order(d.changes, function(c) return c.id == "+10" and 100 or (c.id == "-7" and 50 or 1) end)
check(byId["+5"].order < byId["+10"].order, "a node comes after the node it needs")
check(byId["-11"].order < byId["-7"].order, "refund from the edge: -11 before -7")
check(byId["+10"].needs and byId["+10"].needs[1] == "+5", "needs listed")
check(TreeDiff.tag(byId["+5"]):match("^%d+%. NEW$"), "order number in the tag")
-- Another class: still the node differences, marked not simulated.
local otherClass = fakeSpec(5, 1, { 1, 2, 3, 4, 5 }, { }, { })
local dc = TreeDiff.diff(base, otherClass, baseBuild, otherBuild)
check(dc and dc.classDiffers and dc.note:find("CLASS DIFFERS"), "class difference noted")
local addRow
for _, c in ipairs(dc.changes) do if c.id == "+5" then addRow = c end end
check(addRow and addRow.notSimulated, "other class rows are not simulated")
-- Tones
check(TreeDiff.tone({ dpsPct = 6, ehpPct = 0, hitPct = 0 }).kind == "damage", "damage tone")
check(TreeDiff.tone({ dpsPct = 0, ehpPct = 8, hitPct = 0 }).kind == "defence", "defence tone")
check(TreeDiff.tone({ dpsPct = -20, ehpPct = 0, hitPct = 0 }).kind == "loss", "loss tone")
check(Panel.Legend(true):find("damage gain") and Panel.Legend(true):find("defence gain") and Panel.Legend(true):find("loss"), "gain legend")
check(Panel.Legend(false):find("PoB's compare colours"), "PoB colours legend")

-- B. The Tree tab's planner on a real build --------------------------------------------
local DIR = "Agent/Handlers/"
local handlers = loadfile(DIR .. "Core.lua")(DIR)
launch.agentServer = { handlers = handlers }
local loaded = handlers.load_build_xml({ xml = read(buildFile), name = "Test" })
assert(loaded and loaded.ok, "could not load the build")
local EO, AFS, MB = 22088, 45317, 18174
local e = handlers.edit({ ops = { { op = "spec", create = "AI plan" }, { op = "dealloc", nodes = { EO } }, { op = "alloc", nodes = { AFS, MB } },
	{ op = "spec_notes", notes = { [tostring(AFS)] = "more elemental damage" } }, { op = "spec", index = 1 } } })
check(e.failed == 0, "edit ops: " .. tostring(e.failed))
local tab = build.treeTab
local ok, err = tab:AgentCompare({ compare = 2 })
check(ok, "AgentCompare: " .. tostring(err))
local panel = tab.planPanel
panel:Update()
local plan = panel.plan
check(plan and plan.ok and #plan.changes == 3, "plan with 3 changes: " .. tostring(panel.error))
local rows = { }
for _, c in ipairs(plan and plan.changes or { }) do rows[c.id] = c end
local afs, eo, mb = rows["+" .. AFS], rows["-" .. EO], rows["+" .. MB]
check(afs and afs.order and eo and eo.order and mb and mb.order, "every row numbered")
check(afs and afs.tone and afs.tone.kind == "damage", "Ash, Frost and Storm is a damage gain")
check(mb and mb.tone and mb.tone.kind == "defence", "Mystic Bulwark is a defence gain")
check(eo and eo.tone and eo.tone.kind == "loss", "removing Elemental Overload is a loss")
check(afs.order < eo.order, "the best gain is taken before the loss")
local data = panel:LabelData()
local r, g, b = Panel.NodeColour(data, AFS)
check(r and g > r and g > b, "gain colour: green node")
r, g, b = Panel.NodeColour(data, EO)
check(r and r > g, "gain colour: red node")
panel.gainColours = false
check(Panel.NodeColour(panel:LabelData(), AFS) == nil, "PoB colours when switched off")
panel.gainColours = true
local tip = table.concat(Panel.TooltipLines(data, AFS), "\n")
check(tip:find("NEW Ash, Frost and Storm", 1, true) and tip:find("Why: more elemental damage", 1, true) and tip:find("Its own gain: DPS ^x40FF40+6.", 1, true), "hover lines:\n" .. tip)
local node = build.spec.nodes[AFS]
check(Panel.LabelText(data, node, data.byNode[AFS]):match("^" .. afs.order .. "%. NEW Ash, Frost and Storm"), "box text with order: " .. Panel.LabelText(data, node, data.byNode[AFS]))
-- Untick, then apply one change into a new tree.
panel:SetTicked("-" .. EO, false)
check(panel.plan.plan.ticked == 2 and panel.plan.plan.regrets == 0, "unticked removal recalculated")
local applied = panel:Apply("+" .. AFS)
check(applied and applied.saved and applied.saved.index == 3, "Apply makes tree 3")
check(#tab.specList == 3 and tab.specList[1].allocNodes[EO] and not tab.specList[1].allocNodes[AFS], "the player's tree is unchanged")
check(tab.specList[3].allocNodes[AFS] and tab.specList[3].allocNodes[EO] and not tab.specList[3].allocNodes[MB], "the new tree has only that change")
-- A pasted code: compared without being added to the build.
local done
tab:ComparePasted(read(codeFile), function(okP, errP) done = { okP, errP } end)
check(done and done[1], "pasted code: " .. tostring(done and done[2]))
check(tab.agentCompare and tab.agentCompare.title == "Pasted build" and tab:CompareSpecObj() == tab.agentCompare.spec and #tab.specList == 3, "pasted build is a temporary compare tree")
tab:AgentCompare({ off = true })
check(not tab.isComparing and tab:CompareSpecObj() == nil, "compare off")

-- Switching the active tree while the Tree tab draws (select_tree, the tree dropdown, Apply):
-- every draw path (compare labels, planner, marks) must cope with the new spec at once.
local vp = { x = 312, y = 32, width = 1500, height = 900 }
build.viewMode = "TREE"
local function draws(label)
	local okD, errD = pcall(tab.Draw, tab, vp, { })
	check(okD, label .. ": " .. tostring(errD))
end
tab:AgentCompare({ compare = 2 })
draws("compare on")
handlers.select_tree({ spec = 2 })
draws("select_tree to the compared tree")
handlers.select_tree({ spec = 1 })
draws("select_tree back")
handlers.point_marks({ marks = { { target = "Ash, Frost and Storm" }, { target = "Helmet" } }, tour = true })
handlers.select_tree({ spec = 3 })
draws("marks + select_tree")
for i = 1, 12 do tab:SetActiveSpec((i % #tab.specList) + 1) draws("dropdown switch " .. i) end
handlers.point_marks({ marks = { } })
tab:AgentCompare({ off = true })

print = io.write
if failures > 0 then os.exit(1) end
print("treeplan ok: " .. checks .. " checks\n")
