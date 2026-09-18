// Parses the TRUST_PROXY env var into the value Express's `app.set('trust proxy', ...)`
// expects. Pure function, split out of server/index.js so it is testable without
// importing that file (see CLAUDE.md's "heavyweight test" rule).
//
// 'true'/'false' map to Express's boolean setting; an integer string is the number of
// hops to trust; anything else (an IP, subnet, or 'loopback') is passed straight
// through to Express's own parser (proxy-addr).
function parseTrustProxy(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return raw;
}

module.exports = { parseTrustProxy };
