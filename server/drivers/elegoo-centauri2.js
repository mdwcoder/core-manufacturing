// Elegoo Centauri Carbon 2 driver — MQTT protocol (port 1883)
//
// Unlike the CC1 (SDCP WebSocket), the CC2 uses MQTT with JSON-RPC-style
// method/params messages. Key differences from CC1:
//
//   - Connects via MQTT on port 1883 (username: "elegoo", password: access code)
//   - Requires a registration handshake before any commands are accepted
//   - Serial number is part of all MQTT topic names (stored in printer.serial_number)
//   - Access code from the printer screen is the MQTT password (stored in printer.api_key)
//   - File upload: the printer pulls the file from an HTTP URL we serve (not pushed over MQTT)
//
// Uses the `mqtt` npm package (already installed for the Bambu driver).
//
// Topic scheme:
//   elegoo/{serial}/api_status                    — unsolicited status pushes from printer
//   elegoo/{serial}/{clientId}/api_response       — responses to commands we send
//   elegoo/{serial}/{clientId}/register_response  — registration handshake response
//   elegoo/{serial}/api_register                  — we publish to register
//   elegoo/{serial}/{clientId}/api_request        — we publish commands here
//   elegoo/{serial}/{clientId}/api_heartbeat      — we publish heartbeats here (every 30s)

const mqtt         = require('mqtt');
const crypto       = require('crypto');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const EventEmitter = require('events');

// Map<printerId, ConnectionState>
const connections = new Map();

// Monotonically increasing request ID — matched to pending responses
let _reqId = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Generate a 10-char MQTT client ID: "0cli" + 3 hex timestamp + 3 hex random
function genClientId() {
  const ts   = Date.now().toString(16).slice(-3);
  const rand = Math.floor(Math.random() * 0x1000).toString(16).padStart(3, '0');
  return `0cli${ts}${rand}`;
}

// Return the machine's LAN IPv4 address for constructing the file-download URL.
// Skips loopback and link-local (169.254.x.x). Set SERVER_HOST env var to override.
function getLanIp() {
  if (process.env.SERVER_HOST) return process.env.SERVER_HOST;
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) {
        return info.address;
      }
    }
  }
  return '127.0.0.1';
}

// Map CC2 print_status codes to canonical driver status strings.
// Codes observed in the century-link-ts implementation:
//   0 = IDLE          4 = FINISHED (complete)
//   1 = PRINTING      3 = FINISHED (stopped by user)
//   2 = PAUSED
// Unknown codes map to UNKNOWN (not ERROR) so transient firmware states
// don't hold printers. Log them so we can add explicit cases as needed.
function mapPrintStatus(code) {
  switch (code) {
    case 0: return 'IDLE';
    case 1: return 'PRINTING';
    case 2: return 'PAUSED';
    case 3: return 'FINISHED'; // user-stopped; operator must confirm
    case 4: return 'FINISHED'; // print complete
    default: return 'UNKNOWN';
  }
}

// ─── Connection management ────────────────────────────────────────────────────

function createConnection(printer) {
  const clientId   = genClientId();
  const serial     = printer.serial_number;
  const accessCode = printer.api_key || '123456';

  const emitter = new EventEmitter();
  const conn = {
    client:          null,
    clientId,
    serial,
    pendingRequests: new Map(), // reqId → { resolve, reject, timer }
    registered:      false,
    heartbeat:       null,
    emitter,
    printerName:     printer.name,
  };

  const client = mqtt.connect(`mqtt://${printer.ip}:1883`, {
    clientId,
    username:        'elegoo',
    password:        accessCode,
    connectTimeout:  10_000,
    reconnectPeriod: 5_000,
    clean:           true,
    keepalive:       60,
  });

  conn.client = client;

  // On every (re)connect: re-subscribe and re-register.
  // Registration must happen again after reconnect — the printer doesn't retain
  // client session state across TCP drops.
  client.on('connect', () => {
    console.log(`[elegoo2] ${printer.name} MQTT connected`);
    conn.registered = false;

    const topics = [
      `elegoo/${serial}/api_status`,
      `elegoo/${serial}/${clientId}/api_response`,
      `elegoo/${serial}/${clientId}/register_response`,
    ];

    client.subscribe(topics, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[elegoo2] ${printer.name} subscribe failed: ${err.message}`);
        return;
      }
      client.publish(
        `elegoo/${serial}/api_register`,
        JSON.stringify({ request_id: clientId, client_id: clientId }),
        { qos: 1 }
      );
    });
  });

  client.on('message', (topic, payload) => {
    let msg;
    try { msg = JSON.parse(payload.toString()); } catch (_) { return; }

    if (topic === `elegoo/${serial}/${clientId}/register_response`) {
      if (msg.client_id === clientId && msg.error === 'ok') {
        conn.registered = true;
        emitter.emit('registered');
        console.log(`[elegoo2] ${printer.name} registered (clientId=${clientId})`);

        if (conn.heartbeat) clearInterval(conn.heartbeat);
        conn.heartbeat = setInterval(() => {
          if (client.connected) {
            client.publish(
              `elegoo/${serial}/${clientId}/api_heartbeat`,
              JSON.stringify({ id: 0 }),
              { qos: 1 }
            );
          }
        }, 30_000);
      }

    } else if (topic === `elegoo/${serial}/${clientId}/api_response`) {
      const pending = conn.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        conn.pendingRequests.delete(msg.id);
        pending.resolve(msg);
      }

    }
    // api_status pushes are intentionally ignored — we poll with method 1002 on demand
  });

  client.on('disconnect', () => {
    conn.registered = false;
  });

  client.on('error', (err) => {
    if (process.env.DEBUG_ELEGOO2) {
      console.warn(`[elegoo2] ${printer.name} MQTT error: ${err.message}`);
    }
  });

  return conn;
}

// Wait up to timeoutMs for the registration handshake to complete.
function waitRegistered(conn, timeoutMs = 8_000) {
  if (conn.registered) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Registration timeout')), timeoutMs);
    conn.emitter.once('registered', () => { clearTimeout(timer); resolve(); });
  });
}

// Get (or create) a connected, registered MQTT session for this printer.
async function getConn(printer) {
  if (!connections.has(printer.id)) {
    connections.set(printer.id, createConnection(printer));
  }
  const conn = connections.get(printer.id);

  if (!conn.client.connected) {
    // Auto-reconnect is in flight — wait briefly
    await new Promise(r => setTimeout(r, 2_000));
    if (!conn.client.connected) throw new Error(`${printer.name} MQTT not connected`);
  }

  if (!conn.registered) {
    await waitRegistered(conn);
  }

  return conn;
}

function dropConnection(printerId) {
  const conn = connections.get(printerId);
  if (conn) {
    clearInterval(conn.heartbeat);
    try { conn.client.end(true); } catch (_) {}
    connections.delete(printerId);
  }
}

// Send a command and await the matching response.
async function sendCommand(conn, method, params = {}, timeoutMs = 10_000) {
  const id = ++_reqId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.pendingRequests.delete(id);
      reject(new Error(`Timeout waiting for method ${method} response`));
    }, timeoutMs);

    conn.pendingRequests.set(id, { resolve, reject, timer });

    conn.client.publish(
      `elegoo/${conn.serial}/${conn.clientId}/api_request`,
      JSON.stringify({ id, method, params }),
      { qos: 1 },
      (err) => {
        if (err) {
          clearTimeout(timer);
          conn.pendingRequests.delete(id);
          reject(err);
        }
      }
    );
  });
}

// ─── Public driver interface ──────────────────────────────────────────────────

// Returns { status, progress, timeRemaining, currentFile }
async function getStatus(printer) {
  try {
    const conn = await getConn(printer);
    const resp = await sendCommand(conn, 1002, {});
    const s = resp.result ?? {};

    const canonical = mapPrintStatus(s.print_status);
    const isActive  = canonical === 'PRINTING' || canonical === 'PAUSED';

    if (canonical === 'UNKNOWN') {
      console.log(`[elegoo2] ${printer.name} unknown print_status=${s.print_status} (raw: ${JSON.stringify(s)})`);
    }

    return {
      status:        canonical,
      progress:      isActive ? (s.progress ?? null) : null,
      // total_time and print_time are elapsed/total in seconds
      timeRemaining: isActive && s.total_time != null && s.print_time != null
        ? Math.max(0, s.total_time - s.print_time)
        : null,
      currentFile:   isActive ? (s.filename ?? null) : null,
    };
  } catch (_) {
    dropConnection(printer.id);
    return { status: 'OFFLINE', progress: null, timeRemaining: null, currentFile: null };
  }
}

// Serve the G-code to the printer over HTTP (see /api/gcode-download route in server/index.js),
// then start the print. The CC2 pulls files rather than accepting a push.
//
// Upload flow:
//   1. Compute MD5 of the file
//   2. Send DOWNLOAD_FILE (1057) with the file URL, filename, and MD5
//   3. Give the printer a head-start on the download, then retry START_PRINT (1020)
//      until it returns error_code=0. Non-zero codes during this window mean the file
//      isn't ready yet (download still in progress). Max 20 attempts × 5s = ~103s.
async function uploadAndPrint(printer, gcodeFullPath, filename) {
  const conn = await getConn(printer);

  const fileBuffer = fs.readFileSync(gcodeFullPath);
  const md5        = crypto.createHash('md5').update(fileBuffer).digest('hex');

  const lanIp  = getLanIp();
  const port   = process.env.PORT || 3000;
  const bare   = path.basename(gcodeFullPath);
  const url    = `http://${lanIp}:${port}/api/gcode-download/${encodeURIComponent(bare)}`;
  const taskID = `pfm-${Date.now()}`;

  console.log(`[elegoo2] ${printer.name}: requesting download of "${filename}" from ${url}`);

  const dlResp = await sendCommand(conn, 1057, { filename, url, md5, taskID }, 15_000);
  if (dlResp.result?.error_code !== 0) {
    throw new Error(`DOWNLOAD_FILE rejected by ${printer.name}: error_code=${dlResp.result?.error_code}`);
  }

  // Give the printer time to start fetching before we try to print
  await new Promise(r => setTimeout(r, 3_000));

  const MAX_ATTEMPTS = 20;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const startResp = await sendCommand(conn, 1020, {
        filename,
        storage_location:  'local',
        auto_bed_leveling: false,
        heated_bed_type:   0,
        enable_time_lapse: false,
        force_bed_level:   false,
        slot_map:          [],
      });

      if (startResp.result?.error_code === 0) {
        console.log(`[elegoo2] Print started on ${printer.name}`);
        return;
      }

      lastErr = new Error(`START_PRINT error_code=${startResp.result?.error_code}`);
      console.log(`[elegoo2] ${printer.name} start attempt ${attempt}/${MAX_ATTEMPTS}: error_code=${startResp.result?.error_code} — retrying in 5s`);
    } catch (err) {
      lastErr = err;
      console.warn(`[elegoo2] ${printer.name} start attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`);
    }

    if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 5_000));
  }

  throw lastErr ?? new Error('Failed to start print on ${printer.name} after max retries');
}

async function cancelJob(printer) {
  try {
    const conn = await getConn(printer);
    await sendCommand(conn, 1022, {}); // STOP_PRINT
    console.log(`[elegoo2] Job cancelled on ${printer.name}`);
  } catch (err) {
    console.warn(`[elegoo2] Cancel failed for ${printer.name}: ${err.message}`);
  }
}

async function checkIfPrinting(printer) {
  try {
    const { status } = await getStatus(printer);
    return status === 'PRINTING' || status === 'PAUSED';
  } catch (_) {
    return false;
  }
}

module.exports = { getStatus, uploadAndPrint, cancelJob, checkIfPrinting };
