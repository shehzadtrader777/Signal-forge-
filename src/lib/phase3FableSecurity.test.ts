import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FableOrchestratorRuntime } from './fableOrchestratorServer';
test('Fable public snapshot contains no approval token and live approval remains locked', () => {
  const runtime = new FableOrchestratorRuntime(process.cwd());
  assert.equal(Object.hasOwn(runtime.getSnapshot().deploymentTicket,'approvalToken'),false);
  const result = runtime.approveLiveDeployment();
  assert.equal(result.statusCode,423);
  assert.equal(result.snapshot.deploymentTicket.stage,'PAPER_TRADING');
  const server = fs.readFileSync('server.ts','utf8');
  const route = server.slice(server.indexOf("app.post('/api/fable/deployment/approve-live'"),server.indexOf("app.get('/api/fable/python-source'"));
  assert.ok(route.includes('res.status(423)'));
  assert.doesNotMatch(route,/approvalToken|approveLiveDeployment\(/);
  for (const route of ['evolve','risk/evaluate','options/price']) assert.ok(server.includes("app.post('/api/fable/" + route + "', requireOperatorAuth, requireMasterControlOwner,"));
});
