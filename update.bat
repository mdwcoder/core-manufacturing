@echo off
echo Updating Print Farm Manager...

git pull
if %errorlevel% neq 0 (
    echo ERROR: git pull failed. Check your internet connection or resolve any conflicts.
    pause
    exit /b 1
)

npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

cd client
npm install --legacy-peer-deps
if %errorlevel% neq 0 (
    echo ERROR: client npm install failed.
    cd ..
    pause
    exit /b 1
)
cd ..

npm run build
if %errorlevel% neq 0 (
    echo ERROR: build failed.
    pause
    exit /b 1
)

pm2 restart print-farm-manager
if %errorlevel% neq 0 (
    echo ERROR: pm2 restart failed. Is PM2 installed? Run: npm install -g pm2
    pause
    exit /b 1
)

echo.
echo Done! Print Farm Manager is up to date and running.
pause
