#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${GODSPEED_REPO_URL:-https://github.com/pichimail/godspeed.git}"
REPO_BRANCH="${GODSPEED_BRANCH:-main}"
HOME_DIR="${GODSPEED_HOME:-$HOME/.godspeed}"
APP_DIR="$HOME_DIR/app"
PORT="${GODSPEED_PORT:-7860}"
HOST="${GODSPEED_HOST:-127.0.0.1}"
URL_HOST="$HOST"
if [ "$URL_HOST" = "0.0.0.0" ] || [ "$URL_HOST" = "::" ]; then
  URL_HOST="127.0.0.1"
fi
APP_URL="http://$URL_HOST:$PORT"

say() {
  printf '\033[1;36m[GodSpeed]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[GodSpeed]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[GodSpeed]\033[0m %s\n' "$*" >&2
  exit 1
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

is_port_open() {
  local host="$1"
  local port="$2"
  "$PYTHON_BIN" - "$host" "$port" <<'PY' >/dev/null 2>&1
import socket
import sys
host = sys.argv[1]
port = int(sys.argv[2])
try:
    with socket.create_connection((host, port), timeout=0.5):
        raise SystemExit(0)
except OSError:
    raise SystemExit(1)
PY
}

python_is_supported() {
  "$1" - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 14) else 1)
PY
}

python_version() {
  "$1" - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
PY
}

find_supported_python() {
  if [ -n "${GODSPEED_PYTHON:-}" ]; then
    if [ -x "$GODSPEED_PYTHON" ] && python_is_supported "$GODSPEED_PYTHON"; then
      printf '%s\n' "$GODSPEED_PYTHON"
      return 0
    fi
    fail "GODSPEED_PYTHON must point to Python 3.11, 3.12, or 3.13. Got: $GODSPEED_PYTHON"
  fi

  local candidates=""
  if [ "$(uname -s)" = "Darwin" ]; then
    if [ "$(uname -m)" = "arm64" ]; then
      candidates="/opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3.13 python3.12 python3.11 python3.13"
    else
      candidates="/usr/local/bin/python3.12 /usr/local/bin/python3.11 /usr/local/bin/python3.13 python3.12 python3.11 python3.13"
    fi
  else
    candidates="python3.12 python3.11 python3.13 python3"
  fi

  local cand path
  for cand in $candidates; do
    path="$(command -v "$cand" 2>/dev/null || true)"
    [ -n "$path" ] || continue
    if python_is_supported "$path"; then
      printf '%s\n' "$path"
      return 0
    fi
  done

  return 1
}

ensure_macos_python() {
  if [ "$(uname -s)" != "Darwin" ]; then
    return 0
  fi

  if find_supported_python >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v brew >/dev/null 2>&1; then
    cat >&2 <<'EOF'

GodSpeed needs Python 3.11, 3.12, or 3.13 for the native macOS installer.
Your current python3 is missing or outside that tested range.

Install Homebrew once, then re-run this command:
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

EOF
    exit 1
  fi

  say "Installing Homebrew Python 3.12 for a stable native macOS install"
  brew install python@3.12
}

open_url() {
  if [ "${GODSPEED_NO_OPEN:-}" = "1" ]; then
    return 0
  fi
  if [ "$(uname -s)" = "Darwin" ] && command -v open >/dev/null 2>&1; then
    open "$APP_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 || true
  elif command -v explorer.exe >/dev/null 2>&1; then
    explorer.exe "$APP_URL" >/dev/null 2>&1 || true
  fi
}

docker_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    printf 'docker compose\n'
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    printf 'docker-compose\n'
    return 0
  fi
  return 1
}

ensure_chromadb() {
  local chroma_host="${CHROMADB_HOST:-localhost}"
  local chroma_port="${CHROMADB_PORT:-8100}"

  if is_port_open "$chroma_host" "$chroma_port"; then
    say "ChromaDB already reachable at $chroma_host:$chroma_port"
    return 0
  fi

  local compose_cmd
  compose_cmd="$(docker_compose || true)"
  if [ -z "$compose_cmd" ]; then
    warn "Docker is not available; vector memory/RAG will start in degraded mode until ChromaDB is running."
    warn "Optional later fix: docker compose up -d chromadb"
    return 0
  fi

  if ! docker info >/dev/null 2>&1; then
    warn "Docker is installed but not running; vector memory/RAG will start in degraded mode."
    return 0
  fi

  say "Starting bundled ChromaDB vector service"
  if $compose_cmd up -d chromadb; then
    export CHROMADB_HOST="${CHROMADB_HOST:-localhost}"
    export CHROMADB_PORT="${CHROMADB_PORT:-8100}"
    for _ in $(seq 1 30); do
      if is_port_open "${CHROMADB_HOST}" "${CHROMADB_PORT}"; then
        say "ChromaDB ready at ${CHROMADB_HOST}:${CHROMADB_PORT}"
        return 0
      fi
      sleep 1
    done
    warn "ChromaDB container was started but is not reachable yet; GodSpeed will retry lazily."
  else
    warn "Could not start ChromaDB automatically; GodSpeed will still launch with vector features degraded."
  fi
}

warm_optional_browser_mcp() {
  if command -v npx >/dev/null 2>&1; then
    say "Preparing optional browser MCP package"
    npx -y @playwright/mcp@latest --version >/dev/null 2>&1 || warn "Browser MCP pre-cache skipped; app will still launch."
  fi
}

need git
ensure_macos_python

PYTHON_BIN="$(find_supported_python || true)"
if [ -z "$PYTHON_BIN" ]; then
  fail "Could not find Python 3.11, 3.12, or 3.13. Install one, or pass GODSPEED_PYTHON=/path/to/python3.12."
fi

say "Using Python $(python_version "$PYTHON_BIN") at $PYTHON_BIN"

mkdir -p "$HOME_DIR"

if [ -d "$APP_DIR/.git" ]; then
  say "Updating $APP_DIR"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$REPO_BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$REPO_BRANCH"
else
  say "Cloning GodSpeed into $APP_DIR"
  rm -rf "$APP_DIR"
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

say "Preparing Python environment"
if [ -x venv/bin/python ]; then
  if ! python_is_supported "venv/bin/python"; then
    warn "Existing venv uses unsupported Python $(python_version venv/bin/python); rebuilding it"
    rm -rf venv
  fi
fi

if [ ! -x venv/bin/python ]; then
  "$PYTHON_BIN" -m venv venv
fi

venv/bin/python -m pip install --upgrade pip setuptools wheel
venv/bin/python -m pip install -r requirements.txt

say "Verifying critical imports"
venv/bin/python - <<'PY'
from cryptography.fernet import Fernet
from services.secure_chat_service import get_secure_chat_service
print("secure chat import ok")
PY

ensure_chromadb
warm_optional_browser_mcp

say "Running first-time setup"
ODYSSEUS_SKIP_ADMIN_PROMPT=1 ODYSSEUS_SKIP_RUN_HINT=1 venv/bin/python setup.py

say "Creating Chrome assistant token"
TOKEN="$(
  venv/bin/python - <<'PY'
import json
import secrets
import uuid
from pathlib import Path

import bcrypt

from core.database import ApiToken, Base, engine, get_db_session

Base.metadata.create_all(bind=engine)

auth_path = Path("data/auth.json")
owner = "admin"
if auth_path.exists():
    data = json.loads(auth_path.read_text(encoding="utf-8"))
    users = data.get("users") or {}
    admins = [name for name, user in users.items() if user.get("is_admin") or user.get("role") == "admin"]
    owner = (admins or list(users.keys()) or ["admin"])[0]

raw_token = "ody_" + secrets.token_urlsafe(32)
token_hash = bcrypt.hashpw(raw_token.encode(), bcrypt.gensalt()).decode()
token_id = str(uuid.uuid4())[:8]

with get_db_session() as db:
    db.add(ApiToken(
        id=token_id,
        owner=owner,
        name="GodSpeed Chrome Assistant",
        token_hash=token_hash,
        token_prefix=raw_token[:8],
        scopes="chat",
        is_active=True,
    ))

print(raw_token)
PY
)"

EXT_DIR="$APP_DIR/dist/chrome-assistant"
mkdir -p "$EXT_DIR"
cat > "$EXT_DIR/config.js" <<EOF
globalThis.GODSPEED_INSTALL_CONFIG = {
  baseUrl: "$APP_URL",
  apiToken: "$TOKEN",
  installedAt: "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
};
EOF

say "Starting GodSpeed at $APP_URL"
mkdir -p logs
if is_port_open "$URL_HOST" "$PORT"; then
  say "Port $PORT is already in use; opening the existing GodSpeed session"
else
  nohup venv/bin/python -m uvicorn app:app --host "$HOST" --port "$PORT" > logs/godspeed.log 2>&1 &
  printf '%s\n' "$!" > "$HOME_DIR/godspeed.pid"
fi

open_url

cat <<EOF

GodSpeed is installed and launching.

App:
  $APP_URL

Chrome assistant:
  $EXT_DIR

Load it in Chrome:
  1. Open chrome://extensions
  2. Turn on Developer mode
  3. Click Load unpacked
  4. Select: $EXT_DIR

Logs:
  $APP_DIR/logs/godspeed.log

Stop server:
  kill \$(cat "$HOME_DIR/godspeed.pid") 2>/dev/null || true

EOF
