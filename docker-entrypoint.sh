#!/bin/sh
set -eu

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

workspace-service &
workspace_pid=$!
capture-service &
capture_pid=$!

shutdown() {
    trap '' INT TERM
    kill -TERM "$workspace_pid" "$capture_pid" 2>/dev/null || true
    wait "$workspace_pid" 2>/dev/null || true
    wait "$capture_pid" 2>/dev/null || true
}

trap 'shutdown; exit 0' INT TERM

while kill -0 "$workspace_pid" 2>/dev/null && kill -0 "$capture_pid" 2>/dev/null; do
    sleep 1
done

set +e
if kill -0 "$workspace_pid" 2>/dev/null; then
    wait "$capture_pid"
else
    wait "$workspace_pid"
fi
status=$?
set -e

shutdown
if [ "$status" -eq 0 ]; then
    status=1
fi
exit "$status"
