#!/bin/sh
set -eu
image=${1:?Supply the locally built image tag}
tmp=$(mktemp -d)
container=''
cleanup() {
  if [ -n "$container" ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
cp "$(dirname "$0")/browser-smoke.mjs" "$tmp/"
printf '%s\n' '{"private":true,"type":"module"}' > "$tmp/package.json"
# Install pinned browser client in an isolated folder before entering the offline namespace.
npm install --prefix "$tmp" --no-audit --no-fund --save-exact playwright@1.58.2
SESSION_SIGNING_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
OPERATOR_API_TOKEN=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
export SESSION_SIGNING_KEY OPERATOR_API_TOKEN
container=$(docker run -d --network none -e SESSION_SIGNING_KEY -e OPERATOR_API_TOKEN "$image")
# Share only the application's isolated loopback namespace. No host ports, real credentials or mounts.
docker run --rm --network "container:$container" --mount "type=bind,src=$tmp,dst=/smoke,readonly" -w /smoke mcr.microsoft.com/playwright:v1.58.2-noble node browser-smoke.mjs
