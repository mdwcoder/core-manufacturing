const fs = require('fs');
const path = require('path');

describe('client CSRF coverage', () => {
  test('calendar create and update use the authenticated fetch wrapper', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../client/src/pages/Calendar.jsx'),
      'utf8'
    );

    expect(source).toContain('const res = await apiFetch(url, {');
    expect(source).not.toContain('const res = await fetch(url, {');
  });
});
