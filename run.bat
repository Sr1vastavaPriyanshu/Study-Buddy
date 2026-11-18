@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or is not on PATH.
  echo Install Node.js 22.5 or newer from https://nodejs.org/
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=5)?0:1)"
if errorlevel 1 (
  echo Node.js 22.5 or newer is required.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example.
)

if not exist "backend\node_modules" (
  echo Installing backend dependencies...
  pushd backend
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    popd
    pause
    exit /b 1
  )
  popd
)

echo Starting Study Buddy...
start "" http://127.0.0.1:3000
pushd backend
call npm start
set exitCode=%errorlevel%
popd
exit /b %exitCode%
