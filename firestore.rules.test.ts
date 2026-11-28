import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = import.meta.dirname;
const RULES_PATH = path.resolve(ROOT_DIR, 'firestore.rules');
const BLUEPRINT_PATH = path.resolve(ROOT_DIR, 'firebase-blueprint.json');
const CONFIG_PATH = path.resolve(ROOT_DIR, 'firebase-applet-config.json');

interface BlueprintSchema {
  entities: Record<string, { required?: string[]; properties: Record<string, unknown> }>;
  firestore: Record<string, { schema: { $ref: string }; description: string }>;
}

interface AppletFirebaseConfig {
  projectId: string;
  firestoreDatabaseId: string;
  appId: string;
  apiKey: string;
}

const rulesText = fs.readFileSync(RULES_PATH, 'utf8');
const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8')) as BlueprintSchema;
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as AppletFirebaseConfig;

test('firebase-applet-config.json targets Firestore database ai-studio-bbb47fa7-6d44-40e8-b4b1-545daa3218d3', () => {
  assert.equal(config.firestoreDatabaseId, 'ai-studio-bbb47fa7-6d44-40e8-b4b1-545daa3218d3');
  assert.ok(config.projectId.length > 0 && config.projectId !== 'remixed-project-id');
  assert.ok(config.apiKey.length > 0);
  assert.ok(config.appId.length > 0);
});

test('firestore.rules enforces global default-deny, rules_version 2, and covers every blueprint collection', () => {
  assert.ok(rulesText.startsWith("rules_version = '2';"));
  assert.match(rulesText, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);

  // Never allow open wildcard reads/writes
  assert.equal(/allow\s+(read|write|read,\s*write)\s*:\s*if\s+true\s*;/.test(rulesText), false);

  const expectedMatchFragments = [
    'match /users/{userId}',
    'match /watchlist/{coinId}',
    'match /alerts/{alertId}',
    'match /workspaceConfig/{configId}',
    'match /rollbackSnapshots/{snapshotId}',
    'match /errorLogs/{logId}',
    'match /dailyPnlRecords/{dateKey}',
    'match /vaultLocker/{vaultId}',
  ];

  assert.equal(Object.keys(blueprint.firestore).length, expectedMatchFragments.length);
  for (const fragment of expectedMatchFragments) {
    assert.ok(rulesText.includes(fragment), `Missing rules block for ${fragment}`);
  }
});

test('Dirty Dozen security invariants hold across all 8 Firestore collections', () => {
  // 1. Shadow field injection blocked via hasAll + hasOnly on all 8 validators
  const validators = [
    'isValidUserProfile',
    'isValidWatchlistItem',
    'isValidPriceAlert',
    'isValidWorkspaceControlConfig',
    'isValidRollbackCheckpoint',
    'isValidErrorAuditRecord',
    'isValidDailyPnlRecord',
    'isValidVaultLockerState',
  ];
  for (const fn of validators) {
    const fnStart = rulesText.indexOf(`function ${fn}(`);
    assert.ok(fnStart >= 0, `Validator ${fn} must exist`);
    const body = rulesText.slice(fnStart, fnStart + 1600);
    assert.ok(body.includes('.keys().hasAll('), `${fn} must check hasAll`);
    assert.ok(body.includes('.keys().hasOnly('), `${fn} must check hasOnly`);
    assert.ok(body.includes('request.auth.uid'), `${fn} must bind owner/uid to request.auth.uid`);
  }

  // 2. Unverified email write bypass blocked via isVerified()
  assert.ok(rulesText.includes('request.auth.token.email_verified == true'));

  // 3. ID poisoning guard enforced
  assert.ok(
    rulesText.includes("id is string && id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$')")
  );

  // 4. Temporal integrity via request.time
  assert.ok(rulesText.includes('incoming().createdAt == request.time'));
  assert.ok(rulesText.includes('incoming().updatedAt == request.time'));

  // 5. Immutable collections forbid updates
  const rollbackBlock = rulesText.slice(rulesText.indexOf('match /rollbackSnapshots/{snapshotId}'));
  assert.ok(rollbackBlock.includes('allow update: if false;'));
  const errorLogsBlock = rulesText.slice(rulesText.indexOf('match /errorLogs/{logId}'));
  assert.ok(errorLogsBlock.includes('allow update: if false;'));

  // 6. PII isolation forbids listing /users
  const usersBlock = rulesText.slice(
    rulesText.indexOf('match /users/{userId}'),
    rulesText.indexOf('match /watchlist/{coinId}')
  );
  assert.ok(usersBlock.includes('allow list: if false;'));
  assert.ok(usersBlock.includes('allow delete: if false;'));

  // 7. Query enforcer: every allow list on subcollections validates resource.data.userId == request.auth.uid with zero get()/exists()
  const listMatches = [...rulesText.matchAll(/allow list:\s*([^;]+);/g)].map((m) => m[1]);
  assert.equal(listMatches.length, 8);
  for (const expr of listMatches) {
    if (expr.trim() === 'if false') continue;
    assert.ok(expr.includes('resource.data.userId == request.auth.uid'), `Unsafe list rule: ${expr}`);
    assert.equal(/\b(get|exists)\(/.test(expr), false, `List rule must not call get()/exists(): ${expr}`);
  }

  // 8. Denial-of-Wallet evaluation order (Pillar 10): Auth -> Static validation -> exists() on subcollection creates
  const subCreates = [...rulesText.matchAll(/allow create:\s*([\s\S]*?);/g)].map((m) => m[1]);
  assert.equal(subCreates.length, 8);
  for (const createExpr of subCreates) {
    if (createExpr.trim() === 'if false') continue; // Financial collections are client read-only.
    const verifiedIdx = createExpr.indexOf('isVerified()');
    const ownerIdx = createExpr.indexOf('isOwner(userId)');
    const validIdx = createExpr.indexOf('isValid');
    const existsIdx = createExpr.indexOf('exists(/databases/');
    assert.ok(verifiedIdx >= 0 && ownerIdx > verifiedIdx, 'Auth must run first');
    assert.ok(validIdx > ownerIdx, 'Static validation must follow auth');
    if (existsIdx >= 0) {
      assert.ok(existsIdx > validIdx, 'Master Gate exists() must run after static schema validation');
    }
  }
});

test('reconciled user profile publicId supports legacy migration without arbitrary ID changes', () => {
  const start = rulesText.indexOf('function isValidUserProfile(');
  const end = rulesText.indexOf('function isValidWatchlistItem(', start);
  assert.ok(start >= 0 && end > start);
  const validator = rulesText.slice(start, end);
  assert.ok(validator.includes("data.keys().hasAll(['uid', 'publicId', 'email', 'displayName', 'createdAt', 'updatedAt'])"));
  assert.ok(validator.includes("data.publicId == 'SF-' + userId"));
  const usersStart = rulesText.indexOf('match /users/{userId}');
  const watchlistStart = rulesText.indexOf('match /watchlist/{coinId}', usersStart);
  assert.ok(usersStart >= 0 && watchlistStart > usersStart);
  const profileRules = rulesText.slice(usersStart, watchlistStart);
  assert.ok(profileRules.includes("(!('publicId' in existing()) || incoming().publicId == existing().publicId)"),
    'Once an account ID is set it must not be altered; old profiles may gain the new field');
  assert.ok(profileRules.includes("'publicId', 'displayName', 'email', 'updatedAt'"),
    'Legacy profiles must be allowed to add a validated publicId without changing immutable UID or creation time');
  const firebaseSource = fs.readFileSync(path.resolve(ROOT_DIR, 'src/lib/firebase.ts'), 'utf8');
  assert.ok(firebaseSource.includes('publicId: getSignalForgePublicId(user.uid)'),
    'Both new profiles and legacy updates must write the matching deterministic public ID');
});


test('legacy financial collections deny all browser writes, including owners', () => {
  for (const name of ['dailyPnlRecords/{dateKey}', 'vaultLocker/{vaultId}']) {
    const start = rulesText.indexOf('match /' + name + ' {');
    assert.ok(start >= 0);
    const block = rulesText.slice(start, rulesText.indexOf('\n      }', start));
    for (const action of ['create', 'update', 'delete']) {
      assert.ok(block.includes('allow ' + action + ': if false;'));
    }
    assert.ok(!/allow\s+(?:write|read,\s*write)\s*:/.test(block));
    assert.ok(block.includes('allow get: if isOwner(userId)'));
  }
});
