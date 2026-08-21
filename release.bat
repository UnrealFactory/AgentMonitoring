@echo off
cd /d "%~dp0"
title AgentMonitoring - RELEASE (publish to GitHub)
echo.
echo   Builds the installer and publishes it to GitHub Releases,
echo   so installed apps offer the update on their next check.
echo.
echo   Before running:
echo     1) Bump "version" in package.json, src-tauri/tauri.conf.json and Cargo.toml
echo        (all three must agree - the script checks).
echo     2) Be logged in once with:  gh auth login
echo.
node scripts\release.mjs %*
if errorlevel 1 (
  echo.
  echo   [release FAILED] check the errors above.
  pause
  exit /b 1
)
echo.
pause
