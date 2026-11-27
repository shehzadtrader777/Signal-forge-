"""Exercise an isolated local Signal Forge server using synthetic operator credentials."""
import json
import os
import time
import urllib.error
import urllib.request

token = os.environ["OPERATOR_API_TOKEN"]


def check(route, expected, body=None, code=None, authorized=True):
    headers = {"Content-Type": "application/json"}
    if authorized:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request("http://127.0.0.1:3000" + route, headers=headers, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            status, data = response.status, json.load(response)
    except urllib.error.HTTPError as response:
        status, data = response.code, json.load(response)
    assert status == expected, (route, status, expected)
    assert code is None or data.get("code") == code, (route, data.get("code"), code)
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
