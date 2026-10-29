#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo '{"type":"stop-result","status":"failed","message":"Usage: stop-server.sh <session_dir>"}'
  exit 1
fi

session_dir="$1"
state_dir="$session_dir/state"
server_pid_path="$state_dir/server.pid"
server_log_path="$state_dir/server.log"
server_stopped_path="$state_dir/server-stopped"

write_stop_record() {
  local reason="$1"
  local timestamp
  timestamp="$(node -e 'process.stdout.write(String(Date.now()))')"
  printf '{"reason":"%s","timestamp":%s}\n' "$reason" "$timestamp" > "$server_stopped_path"
}

cleanup_transient_files() {
  rm -f "$server_pid_path" "$server_log_path"
}

if [[ ! -f "$server_pid_path" ]]; then
  cleanup_transient_files
  echo "{\"type\":\"stop-result\",\"status\":\"not-running\",\"session_dir\":\"$session_dir\"}"
  exit 0
fi

server_pid="$(sed -n '1p' "$server_pid_path")"
if [[ -z "$server_pid" ]] || ! [[ "$server_pid" =~ ^[0-9]+$ ]]; then
  cleanup_transient_files
  echo "{\"type\":\"stop-result\",\"status\":\"failed\",\"message\":\"Invalid PID file\",\"session_dir\":\"$session_dir\"}"
  exit 1
fi

if ! kill -0 "$server_pid" 2>/dev/null; then
  cleanup_transient_files
  echo "{\"type\":\"stop-result\",\"status\":\"not-running\",\"session_dir\":\"$session_dir\",\"pid\":$server_pid}"
  exit 0
fi

kill "$server_pid" 2>/dev/null || true

deadline=$(( $(date +%s) + 5 ))
while kill -0 "$server_pid" 2>/dev/null; do
  if (( $(date +%s) >= deadline )); then
    kill -9 "$server_pid" 2>/dev/null || true
    write_stop_record "killed-by-stop-script"
    cleanup_transient_files
    echo "{\"type\":\"stop-result\",\"status\":\"stopped\",\"signal\":\"KILL\",\"session_dir\":\"$session_dir\",\"pid\":$server_pid}"
    exit 0
  fi
  sleep 0.1
done

cleanup_transient_files
echo "{\"type\":\"stop-result\",\"status\":\"stopped\",\"signal\":\"TERM\",\"session_dir\":\"$session_dir\",\"pid\":$server_pid}"
