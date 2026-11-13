@echo off
rem PoB Agent Edition (portable): removes the "pob" MCP server from your AI apps. Builds are not touched.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall -Portable %*
echo.
pause
