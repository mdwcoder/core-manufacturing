# Security

CoMa's login gate started deliberately basic: one shared account, no roles, no CSRF
token, no rate limiting, no TLS. This page is where that surface now lives, in one
place, instead of scattered across `docs/api.md`, `docs/installation.md`, and
`docs/database.md`. It links back to those for request/response shapes and setup
steps; this page is the overview and the threat model.

## Who this protects against, and who it does not

CoMa is built to run on a trusted LAN or VPN, reached by the people operating a print
farm and its attached ERP. The login gate, roles, and everything below stop:

- a stranger who can reach the web UI from opening it without credentials;
- an operator-level account making changes an admin reserved for themselves (backup
  restore, user management, audit log);
- a plain cross-site request (a malicious page in another browser tab) from silently
  mutating data using a logged-in operator's session;
- an automated password-guessing loop against a known username.

It does **not** turn CoMa into a hardened, internet-facing multi-tenant service. Do not
expose ports 3000 (production) or 5173 (Vite dev server) to the internet. If remote
access is needed, put CoMa behind a VPN, or behind a reverse proxy with TLS (see
[HTTPS / reverse proxy](#https--reverse-proxy) below) and further access controls of
your own choosing.

## Accounts and roles

Every operator gets a named account (`server/db.js`'s `users` table), not a shared
login. Four roles, lowest to highest: `viewer`, `operator`, `manager`, `admin`
(`server/auth.js`'s `ROLE_RANK`).

| Role | Can do |
|---|---|
| `viewer` | Read everything the app shows (Fleet, Projects, ERP, ...). Cannot change anything. |
| `operator` | Everything a viewer can, plus every mutating action the app exposes to a logged-in user today: dispatch, set-ready, recommission, manage printers/projects/parts/ERP, etc. |
| `manager` | Everything an operator can, plus `GET /api/backup` (export) and `GET /api/users` / `GET /api/audit-log` (read-only). |
| `admin` | Everything, including user management, `POST /api/backup/restore`, and every other admin-only endpoint listed in [docs/api.md](api.md). |

This is intentionally coarse for the ~20 existing route files (printers, projects,
parts, gcodes, jobs, ERP, ...): a single global `blockViewerWrites()` middleware
rejects any mutating request from a `viewer`, rather than adding a per-route role check
to files that never needed one before roles existed. Only the sensitive surfaces listed
in the table above (users, backup, audit log) have their own, tighter role check. See
[docs/api.md#role-based-route-gating](api.md#role-based-route-gating).

The very first account, created by the setup wizard on a fresh install, is always
`admin`. Every account after that is created by an admin from the Users page
(`POST /api/users`), never self-registered.

## Passwords

- Hashed with Node's built-in `crypto.scrypt`, never stored or logged in plaintext.
- An admin never chooses a new user's password: `POST /api/users` and
  `POST /api/users/:id/reset-password` always generate a random temporary one, returned
  exactly once in the response body, with `must_change_password` set. The client shows
  it in a one-time reveal modal and never fetches it again.
- While `must_change_password` is set, every route is blocked except
  `POST /api/users/me/password`, `GET /api/auth/status`, and `POST /api/auth/logout`:
  the account cannot do anything else until it sets its own password.
- No email-based "forgot password" flow. See
  [docs/installation.md#account-recovery](installation.md#account-recovery): an admin
  resets a locked-out account from the Users page, or, if no admin can log in, a
  console-only script (`server/scripts/reset-admin-password.js`) run directly on the
  machine. SSH/console access to the machine is the security boundary there, the
  correct one for a LAN app with no SMTP configuration to assume.

## Sessions

An HttpOnly `coma_session` cookie, `SameSite=Lax`, 30 day expiry, random token stored in
`auth_sessions`. `Secure` is added only when `COOKIE_SECURE=true` is set (see
[HTTPS / reverse proxy](#https--reverse-proxy)). Every open session can be seen and
revoked from Settings > Account (your own) or the Users page (an admin, over any
account), without ever exposing the real session token to the client: sessions are
addressed by a `display_id`, a truncated hash of the token computed server-side. See
[docs/api.md#sessions](api.md#sessions).

## CSRF header

Every mutating request (`POST`/`PUT`/`DELETE`/`PATCH`) must carry a custom
`X-CoMa-Request: 1` header, except the two routes that issue a session in the first
place (`POST /api/auth/login`, `POST /api/auth/register`). Cookies are already
`SameSite=Lax` with no CORS configuration on the server, so a plain cross-site form post
or fetch cannot set a custom header; requiring one closes the rest of the gap without a
token to generate, store, or rotate. The client adds it automatically through
`client/src/apiFetch.js`; see [docs/api.md#csrf-header](api.md#csrf-header).

## Rate limiting

An in-memory sliding window (`server/rate-limit.js`, no new dependency) bounds repeated
attempts against `POST /api/auth/login`, `POST /api/auth/register`, and
`POST /api/users/:id/reset-password`: 10 attempts per 10 minutes, keyed by IP+username
(login/register) or IP+target-user (reset-password). See
[docs/api.md#rate-limiting](api.md#rate-limiting).

## Audit log

A persistent, never-pruned log (`audit_log` table, `server/audit.js`) of who did what:
logins and failed login attempts, logouts, user management, session revocation, backup
export/restore, and the `completed_qty`-crediting operator actions (set-ready,
set-ready-batch, recommission). Read-only, `manager` and above, from the Audit Log page
or `GET /api/audit-log`. See [docs/api.md#audit-log](api.md#audit-log) and
[docs/database.md](database.md#audit_log).

The audit log itself is excluded from `GET /api/backup` and restore, the same way
`users`/`auth_sessions`/`auth_account` are: an audit trail from one machine should not
be mixed into another machine's history when a backup is restored onto it. It is still
covered by the file-level hourly snapshots `server/backup.js` already takes (the whole
`.db` file, unchanged code); see
[docs/installation.md#data-and-backups](installation.md#data-and-backups).

## Backup and restore

`GET /api/backup` (export, `manager`+) and `POST /api/backup/restore` (`admin` only,
destructive) never include `users`, `auth_sessions`, `auth_account`, or `audit_log`:
restoring a backup on a different machine must never change who can log into it, or
leak a password hash inside the backup JSON. `POST /api/backup/validate` (`admin`)
parses and counts an uploaded file without writing anything, so the restore
confirmation in Settings shows what the file actually contains before the operator
commits to it.

The one piece of user data that does move between installations is the roster itself:
`GET /api/users/export` / `POST /api/users/import` round-trip `{username, role,
is_active}` only, never a password hash. Every imported user gets its own fresh random
temporary password, exactly like creating one by hand. See
[docs/api.md#backup](api.md#backup) and [docs/api.md#users](api.md#users).

## HTTPS / reverse proxy

CoMa speaks plain HTTP itself. Putting a reverse proxy (nginx, Caddy) in front of it is
how to serve it over HTTPS; two opt-in env vars, both defaulting to today's LAN/HTTP
behavior:

- `TRUST_PROXY`: makes `req.ip` (used by rate limiting and the audit log) reflect the
  real client address instead of the proxy's.
- `COOKIE_SECURE=true`: adds `Secure` to the session cookie. Only set this once CoMa is
  actually reached over HTTPS; setting it while still serving plain HTTP breaks login
  silently, since the browser accepts the cookie but never sends it back.

Full nginx/Caddy examples: [docs/installation.md#https--reverse-proxy](installation.md#https--reverse-proxy).

## Reporting a concern

CoMa is a self-hosted fork with no formal disclosure process. Open an issue on the
repository, or reach the maintainer directly for anything sensitive enough not to post
publicly.
