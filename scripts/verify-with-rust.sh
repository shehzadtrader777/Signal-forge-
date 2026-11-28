#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: sh scripts/verify-with-rust.sh /path/to/signal_forge_rust_engine" >&2
  exit 2
fi

socket_dir=$(mktemp -d)
engine_pid=
cleanup() {
  if [ -n "$engine_pid" ]; then
    kill "$engine_pid" 2>/dev/null || true
    wait "$engine_pid" 2>/dev/null || true
  fi
  rm -rf "$socket_dir"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

export SIGNAL_FORGE_IPC_SOCKET="$socket_dir/engine.sock"
"$1" > "$socket_dir/engine.log" 2>&1 &
engine_pid=$!

attempt=0
while [ ! -S "$SIGNAL_FORGE_IPC_SOCKET" ]; do
  if ! kill -0 "$engine_pid" 2>/dev/null || [ "$attempt" -ge 100 ]; then
    cat "$socket_dir/engine.log" >&2
    echo "Rust IPC engine did not open its verification socket." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

npm run verify
