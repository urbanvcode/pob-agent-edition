@echo off
rem PoB Agent Edition (portable): starts PoB. Nothing is installed.
rem It also writes mcp-config.txt with this folder's paths, for AI apps you connect by hand.
setlocal
set "ROOT=%~dp0"
set "FWD=%ROOT:\=/%"
> "%ROOT%mcp-config.txt" echo To connect an AI app by hand, add this "pob" entry to its MCP servers, or run "Connect AI apps.cmd".
>> "%ROOT%mcp-config.txt" echo These are this folder's paths: after moving the folder, start PoB once and copy the entry again.
>> "%ROOT%mcp-config.txt" echo.
>> "%ROOT%mcp-config.txt" echo {"mcpServers": {"pob": {"command": "%FWD%node/node.exe", "args": ["%FWD%agent-mcp/build/index.js"]}}}
start "" /D "%ROOT%PathOfBuilding\runtime" "%ROOT%PathOfBuilding\runtime\Path{space}of{space}Building.exe"
