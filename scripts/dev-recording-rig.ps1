# P1.3 trace-recording rig - starts everything needed for recording sessions.
# Run from repo root:  powershell -File scripts\dev-recording-rig.ps1
# Stop: close the spawned windows.

Set-Location $PSScriptRoot\..

Write-Host "1/4 mongo + redis (docker)..."
docker compose up -d mongo redis

Write-Host "2/4 backend-auth (:3001)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD\backend-auth'; node src/server.js"

Write-Host "3/4 backend-ml pose-only (:8000)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD\backend-ml'; .venv\Scripts\python run_pose_only.py"

Write-Host "4/4 frontend (:5173)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD\frontend'; npm run dev"

Start-Sleep -Seconds 6
Start-Process "http://localhost:5173"
Write-Host "Rig up. Browser opening at http://localhost:5173"
