import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inCmux, openUrl } from '../cli/open.js';

const address = { url: 'http://127.0.0.1:7331', host: '127.0.0.1', port: 7331, pid: 1, store: '/s', started: '' };

test("open goes to a session's page by its bare id, or to the front page", () => {
  assert.equal(openUrl(address), 'http://127.0.0.1:7331');
  assert.equal(openUrl(address, 'session:abc-1'), 'http://127.0.0.1:7331/session/abc-1');
  assert.equal(openUrl(address, 'abc-1'), 'http://127.0.0.1:7331/session/abc-1');
});

test('open docks only inside cmux', () => {
  assert.equal(inCmux({}), false);
  assert.equal(inCmux({ CMUX_PANEL_ID: 'p' }), true);
  assert.equal(inCmux({ CMUX_BUNDLE_ID: 'com.cmuxterm.app' }), true);
});
