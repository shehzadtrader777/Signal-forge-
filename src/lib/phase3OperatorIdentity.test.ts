import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('explicit Firebase identity is evaluated before legacy operator sessions', () => {
  const s = fs.readFileSync('server.ts','utf8');
  const guard = s.slice(s.indexOf('async function requireOperatorAuth('),s.indexOf('async function isRequestAuthenticatedOwnerOrOperator('));
  assert.ok(guard.indexOf('extractFirebaseIdTokenFromRequest(req)') < guard.indexOf('const headerClaims'));
  assert.ok(guard.includes('CURRENT_IDENTITY_NOT_OPERATOR'));
  assert.ok(s.includes("app.post('/api/auth/session/logout'"));
  const firebase = fs.readFileSync('src/lib/firebase.ts','utf8');
  assert.ok(firebase.includes("fetch('/api/auth/session/logout'"));
});
