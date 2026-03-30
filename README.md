# Print Farm Manager

Locally-hosted web app for managing a 50+ printer Prusa fleet via PrusaLink.

## Quick Start

```bash
npm install
cd client && npm install && cd ..
npm run dev
```

- API server: http://localhost:3000
- Web UI: http://localhost:5173

## Phase 1

- Fleet view with live PrusaLink status (15-second poll)
- Printer registry with CSV import
- Settings page for managing printers

## CSV Import Format

| Column | Example |
|---|---|
| name | `MK4S_01` |
| ip | `192.168.15.194` |
| api_key | `aauukLtMLUTqq6e` |
| group | `MK4S Farm` |
| type | `prusa` |

Model is inferred from the printer name automatically.
