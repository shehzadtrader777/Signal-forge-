import fs from 'node:fs';
import path from 'node:path';

// Apply only to the reviewed AI Studio export; refuse unexpected source changes.
const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const serverPath = path.join(root, 'server.ts');
const policyPath = path.join(root, 'src/lib/serverSecurityPolicy.mjs');
if (!fs.existsSync(serverPath) || !fs.existsSync(policyPath)) {
  throw new Error('Expected server.ts and src/lib/serverSecurityPolicy.mjs in target root.');
}
const before = fs.readFileSync(serverPath, 'utf8');
const original = "const SESSION_SIGNING_KEY =\n  process.env.SESSION_SIGNING_KEY || crypto.randomBytes(32).toString('hex');";
const replacement = 'const SESSION_SIGNING_KEY = resolveSessionSigningKey();';
const importLine = "import { resolveSessionSigningKey } from './src/lib/serverSecurityPolicy.mjs';\n";
if (before.includes(replacement) && before.includes(importLine.trim())) {
  console.log('No change: session signing policy already integrated');
  process.exit(0);
}
if (before.split(original).length !== 2 || before.includes(importLine.trim())) {
  throw new Error('Expected unique original fallback and no existing policy import; refusing unsafe edit.');
}
fs.writeFileSync(serverPath, importLine + before.replace(original, replacement), 'utf8');
console.log('Patched server.ts: production signing key now fails closed.');
