"""Exercise an isolated local Signal Forge server using synthetic operator credentials."""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request

token = os.environ["OPERATOR_API_TOKEN"]


def check(route, expected, body=None, code=None, authorized=True, extra_headers=None, response_header=None):
    headers = {"Content-Type": "application/json"}
    if authorized:
        headers["Authorization"] = "Bearer " + token
    headers.update(extra_headers or {})
    req = urllib.request.Request("http://127.0.0.1:3000" + route, headers=headers, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            status, data = response.status, json.load(response)
            result_headers = response.headers
    except urllib.error.HTTPError as response:
        status, data = response.code, json.load(response)
        result_headers = response.headers
    assert status == expected, (route, status, expected)
    assert code is None or data.get("code") == code, (route, data.get("code"), code)
    if response_header:
        key, fragment = response_header
        assert fragment in result_headers.get(key, ""), (route, key, "missing expected header")
    print(route, status, code or "")
    return data

for attempt in range(50):
    try:
        check("/api/health", 200)
        break
    except OSError:
        time.sleep(0.2)
else:
    raise RuntimeError("Server unavailable")
# No real exchange or cloud credentials: the container has --network none.
# Verify the public/owner boundary and financial provenance before emergency halt.
check("/api/monitor/health", 200, authorized=False)
check("/api/vault/state", 401, authorized=False)
snapshot = check("/api/vault/state", 200, response_header=("Cache-Control", "no-store"))
assert snapshot["provenance"] == "UNVERIFIED_RESEARCH_SIMULATION"
assert snapshot["settlementVerified"] is False and snapshot["personalLedger"] is False
check("/api/vault/record-gain", 423, {"realizedPnlUsd": 1}, "UNVERIFIED_VAULT_GAIN_DISABLED")
after = check("/api/vault/state", 200)
assert after["vault"]["stateVersion"] == snapshot["vault"]["stateVersion"], "Rejected gain mutated the vault"
fable = check("/api/fable/status", 200, authorized=False)
assert "approvalToken" not in fable["snapshot"]["deploymentTicket"]
assert fable["snapshot"]["deploymentTicket"]["stage"] == "PAPER_TRADING"
for route in ["/api/fable/evolve", "/api/fable/risk/evaluate", "/api/fable/options/price"]:
    check(route, 401, {}, authorized=False)
check("/api/auth/session", 401, authorized=False, response_header=("Set-Cookie", "Max-Age=0"))
check("/api/auth/session/logout", 200, {}, authorized=False, response_header=("Set-Cookie", "Max-Age=0"))

# Synthetic HMAC session signed with the disposable container-only key.
# Confirm malformed current Firebase identity cannot fall back to this valid old session.
uid = base64.urlsafe_b64encode(b"fixture-operator").decode().rstrip("=")
payload = "v2." + uid + ".SUPER_ADMIN." + str(int(time.time() * 1000) + 60000) + ".fixture-nonce"
signature = hmac.new(os.environ["SESSION_SIGNING_KEY"].encode(), payload.encode(), hashlib.sha256).hexdigest()
legacy = payload + "." + signature
check("/api/fable/evolve", 403, {}, "OWNER_CONTROL_REQUIRED", authorized=False,
      extra_headers={"X-Signal-Session": legacy})
check("/api/fable/evolve", 401, {}, "CURRENT_IDENTITY_NOT_OPERATOR", authorized=False,
      extra_headers={"X-Signal-Session": legacy, "X-Firebase-Id-Token": "invalid-fixture"})
check("/api/fable/evolve", 401, {}, "CURRENT_IDENTITY_NOT_OPERATOR", authorized=False,
      extra_headers={"Cookie": "sf_session=" + legacy, "Sec-Fetch-Site": "same-origin",
                     "X-Firebase-Id-Token": "invalid-fixture"})

for route, payload in [("/api/execution/mode", {"mode":"LIVE"}), ("/api/freqtrade/mode", {"mode":"LIVE"}), ("/api/fable/deployment/approve-live", {})]:
    check(route, 423, payload, "LIVE_TRADING_DISABLED")
halt = "/api/forge-capital/failsafe"
check(halt + "/engage", 401, {}, authorized=False)
assert check(halt + "/engage", 200, {"reason":"Verification"})["state"]["failSafe"]["engaged"]
for route in ["/api/execution/mode", "/api/freqtrade/mode", "/api/fable/deployment/approve-live"]:
    check(route, 423, {"mode": "LIVE"}, "LIVE_TRADING_DISABLED")
for route in ["/api/execution/order", "/api/step2/approve-execute", "/api/freqtrade/signal/execute"]:
    check(route, 423, {}, "EMERGENCY_HALT_ACTIVE")
check(halt + "/recover", 403, {"challengeId":"invalid","confirmationCode":"invalid"})
state = check(halt + "/status", 200)
assert state["state"] == "HALTED_CONFIRMED" and state["executionEnabled"] is False
