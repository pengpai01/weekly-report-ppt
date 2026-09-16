@echo off
REM Independent process for weekly-report-ppt. Stay in this project directory.
cd /d "%~dp0"
node server\index.js
