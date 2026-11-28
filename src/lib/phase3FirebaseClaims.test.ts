import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFirebaseTokenClaims } from '../services/firebaseAuthVerifier';
const now = 1700000000;
const valid = { aud:'test-project', iss:'https://securetoken.google.com/test-project', sub:'test-user', iat:now-10, exp:now+3500, auth_time:now-30, email_verified:true };
test('Firebase claims enforce project, expiry, auth time and strict verification type', () => {
  assert.equal(validateFirebaseTokenClaims(valid,'test-project',now)?.emailVerified,true);
  assert.equal(validateFirebaseTokenClaims({...valid,email_verified:'true'},'test-project',now)?.emailVerified,false);
  for (const claims of [{...valid,exp:now},{...valid,iat:now+301},{...valid,auth_time:undefined},{...valid,auth_time:now+301},{...valid,aud:'other'},{...valid,sub:' '},{...valid,exp:Infinity}]) {
    assert.equal(validateFirebaseTokenClaims(claims,'test-project',now),null);
  }
});
