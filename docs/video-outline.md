# YouTube Video Outline — Print Farm Manager

**Working title:** "I Built Open-Source Software to Manage My 52-Printer 3D Print Farm"

**Target length:** ~25 minutes
**Style:** Screen-capture demo with voiceover; occasional cuts to real hardware for credibility

---

## Before You Film

Run the demo seed on a clean install so you have a realistic fleet without waiting for real prints:

```bash
node server/seed-demo.js --confirm
DEMO_MODE=true npm start
```

This gives you 12 printers across all four brands, in various states (printing, finished waiting for confirmation, error, idle, offline), with job history and completed parts already accumulated.

---

## Section 1 — Hook (0:00–1:30)

**Show on screen:** Fleet view with printers in multiple states — some printing with progress bars, one highlighted FINISHED card waiting for confirmation, one ERROR card.

**Talking points:**
- Open cold on the fleet view — let the UI speak before you say anything
- "This is what it looks like to manage 52 Prusa printers from one screen"
- Tell the old story: walking the floor with a USB drive, checking every screen, manually loading the next file, having no idea what's running where
- "I got tired of it. So I built this. It runs on my farm right now, it's open source, and it's completely free."

---

## Section 2 — What It Is (1:30–3:30)

**Show on screen:** Supported printers table in the README, then a quick pan of the real hardware rack.

**Talking points:**
- A self-hosted web app — runs on any machine on your local network. A Raspberry Pi, an old laptop, a Mac mini in the corner.
- No cloud, no subscription, no account. Your printers never talk to the internet.
- Supported brands: Prusa (PrusaLink), Elegoo Centauri Carbon, Bambu (with AMS slot control), Klipper/Voron via Moonraker
- "If it has an IP address, there's probably a way to connect it"
- One URL works on any device on your network — desktop, phone, the tablet velcro'd to the wall

---

## Section 3 — Install in 3 Minutes (3:30–6:00)

**Show on screen:** Terminal. Run through install commands at a comfortable pace. End on the browser opening to localhost:3000 for the first time — empty fleet, ready to go.

**Talking points:**
- Prerequisites: Node.js 22 LTS (just download the installer from nodejs.org), Git
- Four commands: clone, `npm install`, `npm run build`, `npm start`
- "That's it. No Docker, no config files, no environment variables to set."
- Open localhost:3000 — empty fleet, no printers yet, totally normal
- For production: PM2 keeps it running across reboots. "Full guide in the description."

---

## Section 4 — Setting Up Your Fleet (6:00–10:00)

**Show on screen:** Settings page — add printer models → add a printer manually → show CSV import of a larger batch.

**Talking points:**
- First thing to do: go to Settings → Printer Models and add the models you have (MK4S, X1C, etc.)
- Then add a printer: name it, enter the IP, and the API key or serial number depending on brand
  - **Prusa:** find the API key in PrusaLink web UI under Settings → API Key
  - **Bambu:** enable LAN Mode on the printer. Settings → Network shows the serial number and access code.
  - **Elegoo Centauri:** just needs the IP — no API key
  - **Klipper:** just the IP of the machine running Moonraker (port 7125 is auto-added)
- For a big fleet: CSV import. Show the spreadsheet with name/ip/api_key/type columns, import in one click.
- Switch to Fleet view — watch the printers start polling and their real status come in over the next 15 seconds.

---

## Section 5 — The Fleet View (10:00–13:00)

**Show on screen:** Fleet grid. Zoom in on individual cards in different states. Click through to TV Dashboard.

**Talking points:**
- Each card: printer name, model, status, filename currently printing, progress bar, time remaining
- Status color coding: grey = idle, amber = finished (waiting for you), red = error, dark = offline
- "The amber card is the important one — a print just finished and it's waiting for you to tell it whether it was good or bad before the next job goes out"
- The whole card is clickable to select it for batch confirmation — no tiny checkbox to miss-click
- Live updates every 15 seconds — no manual refresh
- TV Dashboard: switch to this for the monitor on the shop wall. One glance tells you the whole farm status.

---

## Section 6 — The Job Dispatch System (13:00–18:00)

**Show on screen:** Projects page. Create a new project → add a part → upload a G-code file → watch the scheduler dispatch a job to an idle printer.

**Talking points:**
- The mental model: **Project → Parts → G-code → Jobs → Printers**
- Real example: "I need 100 benchies for calibration"
  - Create a project: "Benchy Fleet"
  - Add a part: "Standard Benchy", target qty 100
  - Upload a G-code and tell it: this runs on MK4S, it prints 4 per plate, takes about 3 hours
  - The scheduler picks up the next idle MK4S and dispatches automatically — no USB, no manual file transfer
- Part completion tracking: completed qty goes up when you confirm a good print. When it hits 100, the part is done.
- Bambu AMS: when uploading the G-code, pick which AMS slot (which filament color/material) to pull from.
- "The scheduler dispatches in batches — you can tune the batch size in Settings so you always have a human review before a wave of jobs goes out."

---

## Section 7 — Operator Workflows (18:00–23:00)

**Show on screen:** Walk through each scenario live in the UI. Keep this section snappy — one scenario, show it fully, move on.

### Scenario A — Normal print finishes (the happy path)
- Printer hits FINISHED, card highlights amber
- Click "Set Ready" (or select multiple and batch-confirm)
- Parts counter ticks up; next job dispatches automatically
- "The whole loop — print finishes, you confirm, next job starts — is about 10 seconds of your time"

### Scenario B — Bad print (the blob)
- Printer hits FINISHED — you walk over and it's a spaghetti mess
- Click "Bad Print" — part count is NOT credited, printer goes back to the queue clean
- "The system never double-credits. If you mark it bad, the qty stays where it was."

### Scenario C — Printer goes ERROR mid-print
- Card turns red; scheduler puts the printer on hold automatically — no jobs will go to it
- You fix the real printer, then click through the error confirmation to release the hold
- "The hold exists so a glitching printer can't rack up failed jobs while you're not watching"

### Scenario D — Taking a printer offline for maintenance
- Click Decommission
- "Was the last print successful?" — if yes, the count is credited before it goes offline; if no, it's not
- Printer moves to the Decommissioned tab; recommission it when it's back from nozzle swap

---

## Section 8 — Multi-Brand Showcase (23:00–25:30)

**Show on screen:** Fleet view with one printer of each brand. Point to each card. Briefly show the driver differences in Settings.

**Talking points:**
- Prusa: PrusaLink REST — it tells you progress, time remaining, everything
- Elegoo Centauri Carbon: SDCP WebSocket, near-realtime status
- Bambu X1C: MQTT over LAN — you need LAN mode enabled in the printer settings. AMS slot selection for multi-material prints.
- Klipper/Voron: Moonraker REST on port 7125 — if it runs Klipper, it works. No API key needed.
- "All four brands, one screen, one workflow. You don't need to care which protocol each printer uses."

---

## Section 9 — Open Source and Wrap-Up (25:30–27:00)

**Show on screen:** GitHub repository page. Star button. README.

**Talking points:**
- MIT license — free to use, fork, modify, self-host forever
- "If you run a print farm and this would save you hours a week, please give it a star on GitHub — link is in the description"
- What's next: would love community driver contributions for other brands
- If you want a feature, open an issue
- "This runs on 52 printers every day at 3DPN. I use it because it works."
- Call to action: subscribe, comment with what brand you'd want supported next

---

## Filming Notes

- **Demo mode:** Run `node server/seed-demo.js --confirm` on a clean install, then start with `DEMO_MODE=true npm start`. Seeded statuses (PRINTING, FINISHED, ERROR, IDLE) are preserved — the poller won't overwrite them with OFFLINE since there are no real printers behind the fake IPs.
- **Shot order suggestion:** Film Section 5 (Fleet view) first while the UI is fresh and you're warmed up — it's the most visually compelling section. Film Section 3 (install) last since it's the most scripted and least interesting to re-do.
- **Real hardware cameos:** A short B-roll clip of the actual Prusa rack during Sections 1 and 8 adds a lot of credibility. You don't need it anywhere else.
- **Batch confirmation demo:** Pre-select 3-4 FINISHED cards before recording so you can show the batch workflow in one clean take.
- **Decommission scenario:** The decommission dialog only appears when a printer is not actively printing — use one of the IDLE or FINISHED demo printers for this.
