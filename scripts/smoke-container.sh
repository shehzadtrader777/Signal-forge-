#!/bin/sh
set -eu

image=${1:?Supply the locally built image tag}
SESSION_SIGNING_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
OPERATOR_API_TOKEN=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
export SESSION_SIGNING_KEY OPERATOR_API_TOKEN
container=$(docker run -d --network none -e SESSION_SIGNING_KEY -e OPERATOR_API_TOKEN "$image")
trap 'docker rm -f "$container" >/dev/null' EXIT
trap 'exit 1' HUP INT TERM
docker exec -i "$container" python3 - < "$(dirname "$0")/smoke-trading-locks.py"
