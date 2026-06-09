#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${GODSPEED_REPO_URL:-https://github.com/pichimail/godspeed.git}"
REPO_BRANCH="${GODSPEED_BRANCH:-main}"
HOME_DIR="${GODSPEED_HOME:-$HOME/.godspeed}"
APP_DIR="$HOME_DIR/app"
PORT="${GODSPEED_PORT:-7860}"
HOST="${GODSPEED_HOST:-127.0.0.1}"
APP_URL="http://$HOST:$PORT"

say() {
  printf '\033[1;36m[GodSpeed]\033[0m %s\n' "$*"
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

need git
need python3

mkdir -p "$HOME_DIR"

if [ -d "$APP_DIR/.git" ]; then
  say "Updating $APP_DIR"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$REPO_BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$REPO_BRANCH"
else
  say "Cloning GodSpeed into $APP_DIR"
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

say "Preparing Python environment"
python3 -m venv venv
venv/bin/python -m pip install --upgrade pip
venv/bin/python -m pip install -r requirements.txt

say "Running first-time setup"
ODYSSEUS_SKIP_ADMIN_PROMPT=1 ODYSSEUS_SKIP_RUN_HINT=1 venv/bin/python setup.py

say "Creating Chrome assistant token"
TOKEN="$(
  venv/bin/python - <<'PY'
import json
import os
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
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  say "Port $PORT is already in use; leaving the existing server alone"
else
  nohup venv/bin/python -m uvicorn app:app --host "$HOST" --port "$PORT" > logs/godspeed.log 2>&1 &
  printf '%s\n' "$!" > "$HOME_DIR/godspeed.pid"
fi

if [ "$(uname -s)" = "Darwin" ] && command -v open >/dev/null 2>&1; then
  open "$APP_URL" >/dev/null 2>&1 || true
fi

cat <<EOF

GodSpeed is installed.

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

EOF
