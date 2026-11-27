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
 const adminEmail='amirshehzad2647tcs@gmail.com';
 assert.equal(resolveRbacRoleFromPrincipal({...base,uid:'normal-uid',email:adminEmail,emailVerified:true}),'SUPER_ADMIN');
 assert.equal(resolveRbacRoleFromPrincipal({...base,uid:'normal-uid',email:adminEmail,emailVerified:false}),'TRADER');
 assert.equal(resolveRbacRoleFromPrincipal({...base,uid:'',email:adminEmail,emailVerified:true}),'GUEST');
});
