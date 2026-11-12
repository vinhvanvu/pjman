// The follow window's opening (change:follow-window, decision follow-window/window-not-tab): a window of its own.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handlerOf, windowPlan } from '../cli/follow-window.js';

const URL_ = 'http://127.0.0.1:7331/follow';

test('a Chromium browser opens an app window; Safari and Firefox a new window; Arc its own small window', () => {
  assert.deepEqual(windowPlan(URL_, 'com.google.chrome', 'darwin'), {
    browser: 'Google Chrome',
    how: 'app',
    cmd: 'open',
    args: ['-na', 'Google Chrome', '--args', `--app=${URL_}`],
  });
  assert.equal(windowPlan(URL_, 'Microsoft Edge', 'darwin').how, 'app');
  assert.equal(windowPlan(URL_, 'com.brave.browser', 'darwin').how, 'app');
  const safari = windowPlan(URL_, 'com.apple.safari', 'darwin');
  assert.equal(safari.how, 'window');
  assert.equal(safari.cmd, 'osascript');
  assert.match(safari.args[1]!, /make new document with properties \{URL:"http:\/\/127\.0\.0\.1:7331\/follow"\}/);
  assert.deepEqual(windowPlan(URL_, 'Firefox', 'darwin').args, ['--new-window', URL_]);
  assert.equal(windowPlan(URL_, 'company.thebrowser.browser', 'darwin').how, 'little');
});

test('a browser it does not know is opened by name; none, or another system, takes the system opener', () => {
  assert.deepEqual(windowPlan(URL_, 'Orion', 'darwin'), {
    browser: 'Orion',
    how: 'default',
    cmd: 'open',
    args: ['-a', 'Orion', URL_],
  });
  assert.deepEqual(windowPlan(URL_, undefined, 'darwin'), {
    browser: 'default',
    how: 'default',
    cmd: 'open',
    args: [URL_],
  });
  assert.equal(windowPlan(URL_, 'com.google.chrome', 'linux').cmd, 'xdg-open');
});

test('the default browser is the https handler LaunchServices names', () => {
  const prefs = {
    LSHandlers: [
      { LSHandlerURLScheme: 'mailto', LSHandlerRoleAll: 'com.apple.mail' },
      { LSHandlerURLScheme: 'https', LSHandlerRoleAll: 'com.Google.Chrome' },
    ],
  };
  assert.equal(handlerOf(prefs), 'com.google.chrome');
  assert.equal(handlerOf({}), undefined);
});
