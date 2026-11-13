@echo off
rem PoB Agent Edition (portable): adds the "pob" MCP server to Claude Desktop, Claude Code and Codex,
rem using the Node.js in this folder. No shortcuts, Start menu entries or registry changes.
rem Run it again after moving the folder. "Disconnect AI apps.cmd" removes the entry.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Portable %*
echo.
pause
