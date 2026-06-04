# run_project.ps1

Write-Host "Starting EduVision Project..." -ForegroundColor Green

# 1. Start the Node.js frontend/backend server
Write-Host "Starting Node.js Server on port 3000..." -ForegroundColor Cyan
Start-Process "npm.cmd" -ArgumentList "run dev" -NoNewWindow -PassThru

# 2. Add ffmpeg to PATH if needed (optional but recommended)
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# 3. Start the Flask Python backend server
Write-Host "Starting Flask Python Server on port 5000..." -ForegroundColor Cyan
Push-Location .\hack27
Start-Process ".venv\Scripts\python.exe" -ArgumentList "main.py" -NoNewWindow -PassThru
Pop-Location

Write-Host "Both servers are starting up!" -ForegroundColor Green
Write-Host "Frontend URL: http://localhost:3000" -ForegroundColor Yellow
Write-Host "Flask Backend URL: http://127.0.0.1:5000" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the script (Note: background processes might still run)" -ForegroundColor Red


