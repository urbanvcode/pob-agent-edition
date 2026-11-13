@echo off
rem Installs PoB Agent Edition (shortcuts + MCP server for your AI apps).
rem Usage: Install.cmd            install
rem        Install.cmd -Uninstall remove shortcuts and MCP entries
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
