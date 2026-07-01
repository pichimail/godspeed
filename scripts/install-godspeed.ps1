# GodSpeed one-command installer for Windows PowerShell.
# Safe to re-run. It clones/updates GodSpeed, creates a tested Python venv,
# installs dependencies, runs setup, starts optional ChromaDB when Docker is
# available, launches the app, and writes Chrome assistant config.

$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:GODSPEED_REPO_URL) { $env:GODSPEED_REPO_URL } else { "https://github.com/pichimail/godspeed.git" }
$RepoBranch = if ($env:GODSPEED_BRANCH) { $env:GODSPEED_BRANCH } else { "main" }
$HomeDir = if ($env:GODSPEED_HOME) { $env:GODSPEED_HOME } else { Join-Path $HOME ".godspeed" }
$AppDir = Join-Path $HomeDir "app"
$Port = if ($env:GODSPEED_PORT) { [int]$env:GODSPEED_PORT } else { 7860 }
$BindHost = if ($env:GODSPEED_HOST) { $env:GODSPEED_HOST } else { "127.0.0.1" }
$UrlHost = if ($BindHost -eq "0.0.0.0" -or $BindHost -eq "::") { "127.0.0.1" } else { $BindHost }
$AppUrl = "http://${UrlHost}:${Port}"

function Say([string]$Message) {
  Write-Host "[GodSpeed] $Message" -ForegroundColor Cyan
}

function Warn([string]$Message) {
  Write-Host "[GodSpeed] $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
  Write-Host "[GodSpeed] $Message" -ForegroundColor Red
  exit 1
}

function Ensure-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "Missing required command: $Name. $InstallHint"
  }
}

function Test-PortOpen([string]$HostName, [int]$PortNumber) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect($HostName, $PortNumber, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(500, $false)
    if (-not $ok) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Invoke-PythonCandidate($Candidate, [string[]]$ExtraArgs) {
  $exe = $Candidate.Exe
  $prefix = @()
  if ($Candidate.Args) { $prefix = $Candidate.Args }
  & $exe @prefix @ExtraArgs
}

function Test-PythonSupported($Candidate) {
  try {
    Invoke-PythonCandidate $Candidate @("-c", "import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 14) else 1)") *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Get-PythonVersion($Candidate) {
  Invoke-PythonCandidate $Candidate @("-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
}

function Find-SupportedPython {
  if ($env:GODSPEED_PYTHON) {
    $forced = @{ Exe = $env:GODSPEED_PYTHON; Args = @() }
    if ((Test-Path $env:GODSPEED_PYTHON) -and (Test-PythonSupported $forced)) {
      return $forced
    }
    Fail "GODSPEED_PYTHON must point to Python 3.11, 3.12, or 3.13. Got: $env:GODSPEED_PYTHON"
  }

  $candidates = @(
    @{ Exe = "py"; Args = @("-3.12") },
    @{ Exe = "py"; Args = @("-3.11") },
    @{ Exe = "py"; Args = @("-3.13") },
    @{ Exe = "python3.12"; Args = @() },
    @{ Exe = "python3.11"; Args = @() },
    @{ Exe = "python3.13"; Args = @() },
    @{ Exe = "python"; Args = @() }
  )

  foreach ($candidate in $candidates) {
    if (Get-Command $candidate.Exe -ErrorAction SilentlyContinue) {
      if (Test-PythonSupported $candidate) {
        return $candidate
      }
    }
  }

  return $null
}

function Python-Run($Candidate, [string[]]$ExtraArgs) {
  Invoke-PythonCandidate $Candidate $ExtraArgs
}

function Ensure-ChromaDB {
  $chromaHost = if ($env:CHROMADB_HOST) { $env:CHROMADB_HOST } else { "localhost" }
  $chromaPort = if ($env:CHROMADB_PORT) { [int]$env:CHROMADB_PORT } else { 8100 }

  if (Test-PortOpen $chromaHost $chromaPort) {
    Say "ChromaDB already reachable at ${chromaHost}:${chromaPort}"
    return
  }

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Warn "Docker is not available; vector memory/RAG will start in degraded mode until ChromaDB is running."
    Warn "Optional later fix: docker compose up -d chromadb"
    return
  }

  try {
    docker info *> $null
  } catch {
    Warn "Docker is installed but not running; vector memory/RAG will start in degraded mode."
    return
  }

  Say "Starting bundled ChromaDB vector service"
  try {
    docker compose up -d chromadb
    $env:CHROMADB_HOST = if ($env:CHROMADB_HOST) { $env:CHROMADB_HOST } else { "localhost" }
    $env:CHROMADB_PORT = if ($env:CHROMADB_PORT) { $env:CHROMADB_PORT } else { "8100" }

    for ($i = 0; $i -lt 30; $i++) {
      if (Test-PortOpen $env:CHROMADB_HOST ([int]$env:CHROMADB_PORT)) {
        Say "ChromaDB ready at $($env:CHROMADB_HOST):$($env:CHROMADB_PORT)"
        return
      }
      Start-Sleep -Seconds 1
    }
    Warn "ChromaDB container was started but is not reachable yet; GodSpeed will retry lazily."
  } catch {
    Warn "Could not start ChromaDB automatically; GodSpeed will still launch with vector features degraded."
  }
}

function Warm-BrowserMcp {
  if (Get-Command npx -ErrorAction SilentlyContinue) {
    Say "Preparing optional browser MCP package"
    try {
      npx -y "@playwright/mcp@latest" --version *> $null
    } catch {
      Warn "Browser MCP pre-cache skipped; app will still launch."
    }
  }
}

Ensure-Command "git" "Install Git for Windows: https://git-scm.com/download/win"

$Python = Find-SupportedPython
if (-not $Python) {
  Fail "Could not find Python 3.11, 3.12, or 3.13. Install Python 3.12 from python.org, then re-run."
}

Say "Using Python $(Get-PythonVersion $Python)"

New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null

if (Test-Path (Join-Path $AppDir ".git")) {
  Say "Updating $AppDir"
  git -C $AppDir fetch --all --prune
  git -C $AppDir checkout $RepoBranch
  git -C $AppDir pull --ff-only origin $RepoBranch
} else {
  Say "Cloning GodSpeed into $AppDir"
  if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
  git clone --branch $RepoBranch $RepoUrl $AppDir
}

Set-Location $AppDir

$VenvPy = Join-Path $AppDir "venv\Scripts\python.exe"

if (Test-Path $VenvPy) {
  $venvCandidate = @{ Exe = $VenvPy; Args = @() }
  if (-not (Test-PythonSupported $venvCandidate)) {
    Warn "Existing venv uses unsupported Python; rebuilding it"
    Remove-Item -Recurse -Force (Join-Path $AppDir "venv")
  }
}

if (-not (Test-Path $VenvPy)) {
  Say "Creating Python environment"
  Python-Run $Python @("-m", "venv", "venv")
}

& $VenvPy -m pip install --upgrade pip setuptools wheel
& $VenvPy -m pip install -r requirements.txt

Say "Verifying critical imports"
& $VenvPy -c "from cryptography.fernet import Fernet; from services.secure_chat_service import get_secure_chat_service; print('secure chat import ok')"

Ensure-ChromaDB
Warm-BrowserMcp

Say "Running first-time setup"
$env:ODYSSEUS_SKIP_ADMIN_PROMPT = "1"
$env:ODYSSEUS_SKIP_RUN_HINT = "1"
& $VenvPy setup.py

Say "Creating Chrome assistant token"
$TokenScript = @'
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
'@
$Token = $TokenScript | & $VenvPy -

$ExtDir = Join-Path $AppDir "dist\chrome-assistant"
New-Item -ItemType Directory -Force -Path $ExtDir | Out-Null
$Config = @"
globalThis.GODSPEED_INSTALL_CONFIG = {
  baseUrl: "$AppUrl",
  apiToken: "$Token",
  installedAt: "$([DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"))"
};
"@
Set-Content -Path (Join-Path $ExtDir "config.js") -Value $Config -Encoding UTF8

Say "Starting GodSpeed at $AppUrl"
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir "logs") | Out-Null
$PidFile = Join-Path $HomeDir "godspeed.pid"

if (Test-PortOpen $UrlHost $Port) {
  Say "Port $Port is already in use; opening the existing GodSpeed session"
} else {
  $stdout = Join-Path $AppDir "logs\godspeed.out.log"
  $stderr = Join-Path $AppDir "logs\godspeed.err.log"
  $process = Start-Process -FilePath $VenvPy `
    -ArgumentList @("-m", "uvicorn", "app:app", "--host", $BindHost, "--port", "$Port") `
    -WorkingDirectory $AppDir `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -WindowStyle Minimized `
    -PassThru
  Set-Content -Path $PidFile -Value $process.Id -Encoding ASCII
}

if ($env:GODSPEED_NO_OPEN -ne "1") {
  Start-Process $AppUrl
}

Write-Host ""
Write-Host "GodSpeed is installed and launching."
Write-Host ""
Write-Host "App:"
Write-Host "  $AppUrl"
Write-Host ""
Write-Host "Chrome assistant:"
Write-Host "  $ExtDir"
Write-Host ""
Write-Host "Load it in Chrome:"
Write-Host "  1. Open chrome://extensions"
Write-Host "  2. Turn on Developer mode"
Write-Host "  3. Click Load unpacked"
Write-Host "  4. Select: $ExtDir"
Write-Host ""
Write-Host "Logs:"
Write-Host "  $(Join-Path $AppDir "logs")"
Write-Host ""
Write-Host "Stop server:"
Write-Host "  Stop-Process -Id (Get-Content `"$PidFile`")"
Write-Host ""
