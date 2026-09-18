// Coverage for server/trust-proxy.js: parsing TRUST_PROXY into what Express's
// app.set('trust proxy', ...) expects.

const { parseTrustProxy } = require('../trust-proxy');

test('"true" becomes the boolean true', () => {
  expect(parseTrustProxy('true')).toBe(true);
});

test('"false" becomes the boolean false', () => {
  expect(parseTrustProxy('false')).toBe(false);
});

test('an integer string becomes a number (hop count)', () => {
  expect(parseTrustProxy('1')).toBe(1);
  expect(parseTrustProxy('2')).toBe(2);
});

test('anything else passes through unchanged (IP, subnet, or "loopback")', () => {
  expect(parseTrustProxy('loopback')).toBe('loopback');
  expect(parseTrustProxy('127.0.0.1')).toBe('127.0.0.1');
  expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
});
