# Installation Guide

This guide covers installing Print Farm Manager on a dedicated machine that sits on the same local network as your Prusa fleet. Steps that differ between **Windows** and **macOS** are clearly labelled. Where instructions are the same on both platforms, no label is shown.

---

## Prerequisites

### Node.js

Print Farm Manager requires **Node.js 18 LTS or later**.

**Windows**
1. Go to [https://nodejs.org](https://nodejs.org) and download the **LTS** installer (`.msi`).
2. Run the installer with default options. Ensure **"Add to PATH"** is checked (it is by default).
3. Open a new Command Prompt and verify:
   ```
   node --version
   npm --version
   ```
   If either command is not found, restart your machine and try again.

**macOS**
The recommended approach is [Homebrew](https://brew.sh). If you do not have Homebrew installed, the one-line installer is at [https://brew.sh](https://brew.sh).

```
brew install node
```

Alternatively, download the macOS `.pkg` installer from [https://nodejs.org](https://nodejs.org).

Verify in Terminal:
```
node --version
npm --version
```

---

### Native Build Dependencies

`better-sqlite3` compiles a native binary during `npm install`. Each platform needs the right build tools available or the install will fail.

**Windows**
Run the following in an **Administrator** Command Prompt, then proceed with installation:
```
npm install --global windows-build-tools
```
> If `npm install` succeeds without this step, you can skip it — some Node.js installers bundle the required tools automatically.

**macOS**
Install the Xcode Command Line Tools. Run in Terminal and follow the on-screen prompt:
```
xcode-select --install
```
This is a one-time step. If you have already installed Xcode or the CLI tools previously, you can skip it.

---

### Git (recommended)

Git makes updating the software straightforward. If you prefer to download a ZIP instead, skip this step.

**Windows**
Download from [https://git-scm.com/download/win](https://git-scm.com/download/win) and install with default options.

**macOS**
Git is installed as part of the Xcode Command Line Tools (see above). If you skipped that step:
```
brew install git
```

---

## Getting the Code

### Option A — Git clone (recommended)

**Windows** — open Command Prompt or PowerShell in the folder where you want to install (e.g. `C:\PrintFarm`):
```
git clone https://github.com/YOUR-ORG/print-farm-manager.git
cd print-farm-manager
```

**macOS** — open Terminal and navigate to your preferred location (e.g. `~/PrintFarm`):
```
mkdir -p ~/PrintFarm && cd ~/PrintFarm
git clone https://github.com/YOUR-ORG/print-farm-manager.git
cd print-farm-manager
```

### Option B — Download ZIP

1. Go to the GitHub repository page.
2. Click **Code → Download ZIP**.
3. Extract the ZIP:
   - **Windows:** to a folder such as `C:\PrintFarm\print-farm-manager`
   - **macOS:** to a folder such as `~/PrintFarm/print-farm-manager`
4. Open a terminal and `cd` into that folder.

---

## Installation

Run the following from inside the `print-farm-manager` folder. This installs all server and client dependencies:

```
npm install
cd client
npm install
cd ..
```

This only needs to be done once, and again after an update if dependencies have changed — see [Updating](#updating).

---

## Network Setup

The machine running Print Farm Manager must be on the **same local network** as your printers. All communication happens over HTTP directly to each printer's IP address — no internet connection is required.

### Finding the machine's IP address

You will need this to access the UI from other devices (phones, tablets, other computers) on your network.

**Windows:**
```
ipconfig
```
Look for **IPv4 Address** under your active network adapter (e.g. `192.168.1.50`).

**macOS:**
```
ipconfig getifaddr en0
```
Use `en1` if you are on Wi-Fi and `en0` returns nothing, or check **System Settings → Network**.

### Firewall configuration

The server listens on **port 3000** (API) and **port 5173** (web UI).

**Windows**
Windows Firewall may block connections from other devices on the network. To allow them:

1. Open **Windows Defender Firewall with Advanced Security** (search in the Start menu).
2. Click **Inbound Rules → New Rule**.
3. Select **Port**, click Next.
4. Select **TCP**, enter `3000, 5173`, click Next.
5. Select **Allow the connection**, click Next through the remaining steps and name the rule `Print Farm Manager`.

**macOS**
macOS does not block outbound connections and generally allows LAN traffic by default. If you have manually enabled the macOS Application Firewall (System Settings → Network → Firewall), you may need to add an exception, but most users will not need to do anything here.

---

## Running the Server

From the `print-farm-manager` folder:

```
npm run dev
```

This starts both the API server and the web UI simultaneously. You should see:

```
[server] Express running on http://localhost:3000
[poller] Starting poll loop (interval: 15000ms)
[scheduler] Starting job scheduler
```

- On the **local machine**: open a browser to **http://localhost:5173**
- From **any other device on the network**: use the machine's IP address — e.g. **http://192.168.1.50:5173**

To stop the server, press `Ctrl + C` in the terminal.

---

## Keeping It Running (Auto-start on Boot)

Running `npm run dev` manually is fine for testing, but a farm machine should start the server automatically on boot and restart it if it crashes. **PM2** is a Node.js process manager that handles this on both platforms.

### Install PM2

**Windows:**
```
npm install --global pm2
npm install --global pm2-windows-startup
```

**macOS:**
```
npm install --global pm2
```

### Start Print Farm Manager with PM2

From the `print-farm-manager` folder (same on both platforms):
```
pm2 start npm --name "print-farm-manager" -- run dev
```

Verify it is running:
```
pm2 list
```
You should see `print-farm-manager` with status `online`.

### Enable Auto-start on Boot

**Windows:**
```
pm2-startup install
pm2 save
```

**macOS:**
```
pm2 startup
```
PM2 will print a command beginning with `sudo env PATH=...` — copy and run that exact command, then:
```
pm2 save
```

Print Farm Manager will now start automatically whenever the machine boots, with no login required.

### Useful PM2 Commands

| Command | What it does |
|---|---|
| `pm2 list` | Show all running processes and their status |
| `pm2 logs print-farm-manager` | Stream live server logs |
| `pm2 logs print-farm-manager --lines 100` | Show last 100 log lines |
| `pm2 restart print-farm-manager` | Restart the server |
| `pm2 stop print-farm-manager` | Stop the server |
| `pm2 delete print-farm-manager` | Remove it from PM2 entirely |

---

## Data & File Storage

All persistent data lives inside the `print-farm-manager` folder:

| Path | Contents |
|---|---|
| `server/data/farm.db` | SQLite database — all printers, projects, parts, jobs |
| `server/gcode/` | Uploaded G-code files |

**Back these up regularly.** If you reinstall or move the software, copy both locations to preserve your printer registry, project history, and G-code library. Neither folder is tracked by Git — they are created automatically on first run.

---

## Updating

### Git install

```
git pull
npm install
cd client && npm install && cd ..
pm2 restart print-farm-manager
```

### ZIP install

1. Download the new ZIP from GitHub.
2. Extract it to a **new** folder — do not overwrite the existing one.
3. Copy `server/data/` and `server/gcode/` from the old folder into the new one.
4. Run `npm install` and `cd client && npm install && cd ..` in the new folder.
5. Update PM2 to point at the new folder:

**Windows:**
```
pm2 delete print-farm-manager
cd C:\PrintFarm\print-farm-manager-NEW
pm2 start npm --name "print-farm-manager" -- run dev
pm2 save
```

**macOS:**
```
pm2 delete print-farm-manager
cd ~/PrintFarm/print-farm-manager-NEW
pm2 start npm --name "print-farm-manager" -- run dev
pm2 save
```

---

## Troubleshooting

**`node` or `npm` not found after installing Node.js**
Restart your machine. The PATH change from the installer requires a full restart to take effect.

**`npm install` fails with a native build error**

*Windows* — install Windows Build Tools in an Administrator Command Prompt:
```
npm install --global windows-build-tools
```

*macOS* — install Xcode Command Line Tools:
```
xcode-select --install
```

Then retry `npm install`.

**UI loads but shows no printers / API errors**
- Confirm the server is running: `pm2 list`
- Check server logs: `pm2 logs print-farm-manager`
- Confirm ports 3000 and 5173 are not blocked (Windows: check Firewall rules; macOS: check if Application Firewall is on)

**Printers show as OFFLINE**
- Confirm the farm machine and the printers are on the same network subnet.
- Open `http://<printer-ip>/api/v1/status` in a browser on the farm machine. If it loads, the server can reach the printer. If not, it is a network or switch issue.

**Port 3000 or 5173 already in use**

*Windows:*
```
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

*macOS:*
```
lsof -i :3000
kill -9 <PID>
```

**Server starts but UI does not load on another device**
- Use the machine's LAN IP address — `localhost` only resolves on the machine itself.
- Windows: confirm the Firewall inbound rule covers ports 3000 and 5173.
- Check that both devices are on the same network VLAN. Some managed switches isolate VLANs from each other.
