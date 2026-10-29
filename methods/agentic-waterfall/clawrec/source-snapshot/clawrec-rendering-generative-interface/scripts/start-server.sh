#!/usr/bin/env bash

set -euo pipefail

project_dir=""
bind_host="127.0.0.1"
url_host=""
launch_mode="auto"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir)
      if [[ $# -lt 2 ]]; then
        echo '{"type":"startup-error","message":"Missing value for --project-dir"}'
        exit 1
      fi
      project_dir="$2"
      shift 2
      ;;
    --host)
      if [[ $# -lt 2 ]]; then
        echo '{"type":"startup-error","message":"Missing value for --host"}'
        exit 1
      fi
      bind_host="$2"
      shift 2
      ;;
    --url-host)
      if [[ $# -lt 2 ]]; then
        echo '{"type":"startup-error","message":"Missing value for --url-host"}'
        exit 1
      fi
      url_host="$2"
      shift 2
      ;;
    --foreground)
      launch_mode="foreground"
      shift
      ;;
    --background)
      launch_mode="background"
      shift
      ;;
    *)
      echo "{\"type\":\"startup-error\",\"message\":\"Unknown option: $1\"}"
      exit 1
      ;;
  esac
done

if [[ -z "$project_dir" ]]; then
  project_dir="$(pwd)"
fi

project_dir="$(cd "$project_dir" && pwd)"

if [[ -z "$url_host" ]]; then
  case "$bind_host" in
    127.0.0.1|::1|localhost)
      url_host="localhost"
      ;;
    *)
      url_host="$bind_host"
      ;;
  esac
fi

if [[ "$launch_mode" == "auto" ]]; then
  parent_command="$(ps -o command= -p "$PPID" 2>/dev/null || true)"
  if [[ "$parent_command" == *"Codex.app/Contents/Resources/codex app-server"* ]]; then
    launch_mode="foreground"
  else
    launch_mode="background"
  fi
fi

session_id="session-$(date +%s)-$$-${RANDOM}"
session_dir="$project_dir/.clawrec/clawrec-generative-interface/$session_id"
screen_dir="$session_dir/content"
state_dir="$session_dir/state"
server_log_path="$state_dir/server.log"
server_info_path="$state_dir/server-info"
server_pid_path="$state_dir/server.pid"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
server_script="$script_dir/server.cjs"
owner_pid="$PPID"

mkdir -p "$screen_dir/assets" "$state_dir"

if [[ "$launch_mode" == "foreground" ]]; then
  echo "$$" > "$server_pid_path"
  exec env \
    SCREEN_DIR="$screen_dir" \
    STATE_DIR="$state_dir" \
    HOST="$bind_host" \
    URL_HOST="$url_host" \
    OWNER_PID="$owner_pid" \
    node "$server_script"
fi

touch "$server_log_path"
if command -v python3 >/dev/null 2>&1; then
  env \
    SCREEN_DIR="$screen_dir" \
    STATE_DIR="$state_dir" \
    HOST="$bind_host" \
    URL_HOST="$url_host" \
    OWNER_PID="$owner_pid" \
    python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
    node "$server_script" </dev/null >>"$server_log_path" 2>&1 &
else
  nohup env \
    SCREEN_DIR="$screen_dir" \
    STATE_DIR="$state_dir" \
    HOST="$bind_host" \
    URL_HOST="$url_host" \
    OWNER_PID="$owner_pid" \
    node "$server_script" </dev/null >>"$server_log_path" 2>&1 &
fi

server_pid="$!"
echo "$server_pid" > "$server_pid_path"

deadline=$(( $(date +%s) + 10 ))
while true; do
  if [[ -f "$server_info_path" ]]; then
    sleep 0.2
    if kill -0 "$server_pid" 2>/dev/null; then
      sed -n '1p' "$server_info_path"
      exit 0
    fi
    echo "{\"type\":\"startup-error\",\"message\":\"Server exited after writing startup info\",\"state_dir\":\"$state_dir\"}"
    exit 1
  fi

  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "{\"type\":\"startup-error\",\"message\":\"Server exited before announcing startup\",\"state_dir\":\"$state_dir\"}"
    exit 1
  fi

  if (( $(date +%s) >= deadline )); then
    kill "$server_pid" 2>/dev/null || true
    rm -f "$server_pid_path"
    echo "{\"type\":\"startup-error\",\"message\":\"Timed out waiting for startup\",\"state_dir\":\"$state_dir\"}"
    exit 1
  fi

  sleep 0.1
done
