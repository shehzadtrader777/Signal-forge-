import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {resolveRbacRoleFromPrincipal} from './rbac';
import type {SubscriptionPrincipal} from './subscriptionGatekeeper';

const base:SubscriptionPrincipal={
 authenticated:true,uid:'operator-cli-token',email:'ordinary-user@example.invalid',emailVerified:true,
 tier:'PRO',status:'ACTIVE',expiresAtMs:null,entitlementId:null,planLabel:'Pro'
};
test('operator-looking UID cannot elevate a normal verified user',()=>{
 assert.equal(resolveRbacRoleFromPrincipal(base),'TRADER');
 assert.equal(resolveRbacRoleFromPrincipal({...base,tier:'PREMIUM_INSTITUTIONAL'}),'QUANT_ANALYST');
});
test('verified explicit admin email remains recognized only for authenticated principal',()=>{
 const adminEmail='admin@example.invalid';
 assert.equal(resolveRbacRoleFromPrincipal({...base,uid:'normal-uid',email:adminEmail,emailVerified:true},[adminEmail]),'SUPER_ADMIN');
 assert.equal(resolveRbacRoleFromPrincipal({...base,uid:'normal-uid',email:adminEmail,emailVerified:false},[adminEmail]),'TRADER');
 assert.equal(resolveRbacRoleFromPrincipal({...base,uid:'',email:adminEmail,emailVerified:true},[adminEmail]),'GUEST');
});

test('automation-looking UID cannot elevate a normal verified user',()=>{
 assert.equal(resolveRbacRoleFromPrincipal({...base,uid:'ci-operator-automation'}),'TRADER');
 assert.equal(resolveRbacRoleFromPrincipal({...base,uid:'ci-operator-automation',tier:'PREMIUM_INSTITUTIONAL'}),'QUANT_ANALYST');
});
