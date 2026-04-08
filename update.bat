@echo off
rem Always run from the directory this bat file lives in (the repo root),
rem regardless of where it was launched from.
cd /d %~dp0

echo ============================================================
echo  Print Farm Manager — Update
echo ============================================================
echo.

echo [1/4] Pulling latest code from GitHub...
git pull
if %errorlevel% neq 0 (
    echo.
    echo ERROR: git pull failed. Check your internet connection or resolve conflicts.
    pause
    exit /b 1
)
echo Done.
echo.

echo [2/4] Installing server dependencies...
npm install
rem npm exits non-zero on peer-dep warnings even when install succeeds.
rem Only treat it as a real failure if node_modules is missing afterwards.
if not exist node_modules (
    echo.
    echo ERROR: server npm install failed — node_modules not created.
    pause
    exit /b 1
)
echo Done.
echo.

echo [3/4] Building client...
cd client
npm install --legacy-peer-deps
if not exist node_modules (
    echo.
    echo ERROR: client npm install failed — node_modules not created.
    cd ..
    pause
    exit /b 1
)
npm run build
if %errorlevel% neq 0 (
    echo.
    echo ERROR: client build failed. See output above.
    cd ..
    pause
    exit /b 1
)
cd ..
echo Done.
echo.

echo [4/4] Restarting server...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul
echo.
echo ============================================================
echo  Update complete! Server starting below.
echo  Close this window to stop the server.
echo ============================================================
echo.
node server\index.js
