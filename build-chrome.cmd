@echo off
REM Wrapper for build-chrome.ps1.
REM Windows blocks .ps1 execution by default (Restricted policy). This bypasses it for
REM this process only, without changing any system setting.
REM Arguments pass through:  build-chrome.cmd -Package
REM (ASCII only -- cmd.exe reads batch files as ANSI, so non-ASCII comments break parsing.)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-chrome.ps1" %*
