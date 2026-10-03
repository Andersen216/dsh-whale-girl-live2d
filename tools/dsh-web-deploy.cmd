@echo off
chcp 65001 >nul
rem DSH 网页版一键部署（Windows 双击即用）—— 绕开 PowerShell 执行策略
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dsh-web-deploy.ps1" %*
pause
