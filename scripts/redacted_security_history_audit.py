#!/usr/bin/env python3
"""Read-only heuristic scan of reachable Git blobs. Emit aggregate counts only.
Not a substitute for Gitleaks, provider verification, rotation, or private triage.
"""
import collections
import json
import re
import subprocess

MAX_BYTES = 5 * 1024 * 1024
PATTERNS = {
    "private_key_header": rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----",
    "github_token_shape": rb"(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})",
    "aws_access_id_shape": rb"(?:AKIA|ASIA)[A-Z0-9]{16}",
    "google_api_key_shape": rb"AIza[0-9A-Za-z_-]{35}",
    "slack_token_shape": rb"xox[baprs]-[A-Za-z0-9-]{20,}",
    "discord_webhook_shape": rb"https://(?:discord(?:app)?\.com)/api/webhooks/[0-9]{16,22}/[A-Za-z0-9_-]{30,}",
    "telegram_bot_token_shape": rb"(?<![0-9])[0-9]{8,12}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])",
    "stripe_secret_key_shape": rb"sk_(?:live|test)_[A-Za-z0-9]{20,}",
}
PATTERNS = {key: re.compile(value) for key, value in PATTERNS.items()}

def git(*args):
    return subprocess.check_output(["git", *args])

def main():
    current = {
        item.split(b"\t", 1)[0].split()[2]
        for item in git("ls-tree", "-r", "-z", "HEAD").split(b"\0")
        if item and item.split(b"\t", 1)[0].split()[1] == b"blob"
    }
    # Only object IDs are passed to the batch process; never print paths or values.
    ids = {line.split(b" ", 1)[0] for line in git("rev-list", "--objects", "--all").splitlines()}
    ids.update(current)
    metadata = subprocess.check_output(
        ["git", "cat-file", "--batch-check"],
        input=b"\n".join(sorted(ids)) + b"\n",
    )
    blobs = []
    skipped_large = 0
    for line in metadata.splitlines():
        parts = line.split()
        if len(parts) != 3 or parts[1] != b"blob":
            continue
        size = int(parts[2])
        if size > MAX_BYTES:
            skipped_large += 1
        else:
            blobs.append((parts[0], size))
    counts = {group: collections.Counter() for group in ("current", "history_only")}
    binary = 0
    scanned = 0
    with subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
        for oid, size in blobs:
            process.stdin.write(oid + b"\n")
            process.stdin.flush()
            header = process.stdout.readline().split()
            if header != [oid, b"blob", str(size).encode()]:
                raise RuntimeError("Unexpected Git blob response")
            data = process.stdout.read(size)
            if len(data) != size or process.stdout.read(1) != b"\n":
                raise RuntimeError("Incomplete Git blob response")
            if b"\0" in data:
                binary += 1
                continue
            scanned += 1
            group = "current" if oid in current else "history_only"
            for label, pattern in PATTERNS.items():
                if pattern.search(data):
                    counts[group][label] += 1
        process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError("Git object scan failed")
    print(json.dumps({
        "status": "HEURISTIC_AUDIT_ONLY_NOT_CLEARANCE",
        "tracked_current_blobs": len(current),
        "scanned_unique_text_blobs": scanned,
        "skipped_binary_blobs": binary,
        "skipped_oversize_blobs": skipped_large,
        "matching_blob_counts": {group: dict(counter) for group, counter in counts.items()},
        "scope": "reachable fetched refs and current HEAD; no secret values, paths or object IDs emitted"
    }, indent=2, sort_keys=True))

if __name__ == "__main__":
    main()
