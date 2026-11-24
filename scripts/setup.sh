#!/usr/bin/env bash
# =====================================================================
#  BCPP Aktenverwaltung – Ein-Befehl-Setup für Debian / Ubuntu (als root)
#
#    curl -fsSL https://raw.githubusercontent.com/nikesieg4/Polis-Verwaltungs-Application/main/scripts/setup.sh | bash
#
#  Optionen (als Umgebungsvariablen vor "bash"):
#    BRANCH=main            Git-Branch, der installiert und aktualisiert wird
#    APP_DIR=/opt/bcpp-bot  Installationsordner
#    DISCORD_TOKEN=...      Token ohne Nachfrage setzen
#  Parameter:
#    --reconfigure          .env neu abfragen
#    --units-only           nur systemd-Dienste + bcpp-bot Befehl neu schreiben (vom Updater genutzt)
# =====================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/nikesieg4/Polis-Verwaltungs-Application.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/bcpp-bot}"
APP_USER="bcpp"
SERVICE="bcpp-bot"
CLIENT_ID_DEFAULT="1574700107566284830"
NODE_MAJOR=24

c_blue=$'\e[1;34m'; c_green=$'\e[1;32m'; c_yellow=$'\e[1;33m'; c_red=$'\e[1;31m'; c_off=$'\e[0m'
step() { echo -e "\n${c_blue}==>${c_off} $*"; }
ok()   { echo -e "${c_green}✔${c_off} $*"; }
warn() { echo -e "${c_yellow}!${c_off} $*"; }
die()  { echo -e "${c_red}✘ $*${c_off}" >&2; exit 1; }

# Eingaben auch bei "curl ... | bash" von der Tastatur lesen
ask() {        # ask VAR "Frage" [geheim]
  local __var=$1 __prompt=$2 __secret=${3:-} __val=""
  if [[ -r /dev/tty ]]; then
    if [[ -n $__secret ]]; then read -rsp "$__prompt" __val </dev/tty; echo; else read -rp "$__prompt" __val </dev/tty; fi
  fi
  printf -v "$__var" '%s' "$__val"
}

install_units() {
  step "Systemdienste einrichten"
  cat >/etc/systemd/system/${SERVICE}.service <<UNIT
[Unit]
Description=BCPP Aktenverwaltung (Discord-Bot)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/env node --disable-warning=ExperimentalWarning src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${APP_DIR}/data

[Install]
WantedBy=multi-user.target
UNIT

  cat >/etc/systemd/system/${SERVICE}-update.service <<UNIT
[Unit]
Description=BCPP Aktenverwaltung – Auto-Update aus GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash ${APP_DIR}/scripts/update.sh
UNIT

  cat >/etc/systemd/system/${SERVICE}-update.timer <<UNIT
[Unit]
Description=BCPP Aktenverwaltung – alle 5 Minuten nach Updates suchen

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

  ln -sf "${APP_DIR}/scripts/bcpp-bot" /usr/local/bin/bcpp-bot
  chmod +x "${APP_DIR}/scripts/"*.sh "${APP_DIR}/scripts/bcpp-bot"
  systemctl daemon-reload
  systemctl enable --quiet ${SERVICE}.service ${SERVICE}-update.timer
  systemctl start ${SERVICE}-update.timer
  ok "Dienste ${SERVICE} und ${SERVICE}-update.timer aktiv"
}

fix_permissions() {
  mkdir -p "${APP_DIR}/data"
  chown -R root:root "${APP_DIR}"
  chown -R ${APP_USER}:${APP_USER} "${APP_DIR}/data"
  [[ -f "${APP_DIR}/.env" ]] && { chown root:${APP_USER} "${APP_DIR}/.env"; chmod 640 "${APP_DIR}/.env"; }
  chmod 600 "${APP_DIR}/.git/config" 2>/dev/null || true
}

if [[ ${1:-} == "--units-only" ]]; then
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  install_units
  fix_permissions
  exit 0
fi

# ---------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "Bitte als root ausführen (z. B. mit: sudo -i)"
command -v apt-get >/dev/null || die "Dieses Setup ist für Debian/Ubuntu (apt) gedacht."
command -v systemctl >/dev/null || die "systemd wird benötigt."

echo -e "${c_blue}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║   🚔  BCPP Aktenverwaltung – Setup                ║"
echo "  ║       Berlin City Polizeipräsidium                ║"
echo "  ╚══════════════════════════════════════════════════╝${c_off}"

step "Systempakete installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg >/dev/null
ok "git, curl installiert"

step "Node.js prüfen"
node_major=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)
if [[ -z $node_major || $node_major -lt 22 ]]; then
  echo "Installiere Node.js ${NODE_MAJOR} …"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node.js $(node -v)"

step "Benutzer ${APP_USER} anlegen"
id -u ${APP_USER} >/dev/null 2>&1 || useradd --system --home-dir "${APP_DIR}" --no-create-home --shell /usr/sbin/nologin ${APP_USER}
ok "Benutzer ${APP_USER} vorhanden"

step "Code aus GitHub holen (${BRANCH})"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch --quiet origin "${BRANCH}"
  git -C "${APP_DIR}" checkout --quiet --force -B "${BRANCH}" FETCH_HEAD
  git -C "${APP_DIR}" branch --quiet --set-upstream-to="origin/${BRANCH}" "${BRANCH}" 2>/dev/null || true
else
  if ! git ls-remote "${REPO_URL}" >/dev/null 2>&1; then
    warn "Repository ist nicht öffentlich erreichbar."
    ask GH_TOKEN "GitHub-Token mit Lesezugriff auf das Repo: " secret
    [[ -n ${GH_TOKEN} ]] || die "Ohne Zugriff auf das Repository geht es nicht weiter."
    REPO_URL="${REPO_URL/https:\/\//https://x-access-token:${GH_TOKEN}@}"
  fi
  git clone --quiet --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}" || die "Klonen fehlgeschlagen (Branch '${BRANCH}' vorhanden?)"
fi
git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true
ok "Code in ${APP_DIR}"

# ---------------------------------------------------------------------
ENV_FILE="${APP_DIR}/.env"
if [[ ! -f $ENV_FILE || ${1:-} == "--reconfigure" ]]; then
  step "Konfiguration (.env)"
  TOKEN="${DISCORD_TOKEN:-}"
  while [[ -z $TOKEN ]]; do
    echo "Bot-Token findest du im Discord Developer Portal → deine Anwendung → Bot → Reset Token."
    ask TOKEN "Bot-Token (Eingabe unsichtbar): " secret
    [[ -n $TOKEN ]] || { [[ -r /dev/tty ]] || die "Kein Terminal – DISCORD_TOKEN=... vor den Befehl schreiben."; continue; }
    BOT_NAME=$(curl -fsS -H "Authorization: Bot ${TOKEN}" https://discord.com/api/v10/users/@me 2>/dev/null \
      | sed -nE 's/.*"username": ?"([^"]+)".*/\1/p' || true)
    if [[ -z ${BOT_NAME} ]]; then warn "Token ungültig – bitte erneut eingeben."; TOKEN=""; else ok "Token gültig – Bot: ${BOT_NAME}"; fi
  done

  D1_ACCOUNT=""; D1_DB=""; D1_TOKEN=""
  ask USE_D1 "Cloudflare D1 als Datenbank verwenden? (j/N, Standard: lokale SQLite-Datei): "
  if [[ ${USE_D1,,} == j* || ${USE_D1,,} == y* ]]; then
    ask D1_ACCOUNT "Cloudflare Account-ID: "
    ask D1_DB "D1 Datenbank-ID: "
    ask D1_TOKEN "Cloudflare API-Token (D1 Edit, unsichtbar): " secret
  fi

  umask 077
  cat >"$ENV_FILE" <<ENV
# BCPP Aktenverwaltung – Konfiguration (wird von Git ignoriert)
DISCORD_TOKEN=${TOKEN}
CLIENT_ID=${CLIENT_ID_DEFAULT}

# Datenbank: leer lassen = automatisch (D1 wenn unten ausgefüllt, sonst SQLite)
DB_DRIVER=
SQLITE_PATH=./data/bcpp.db

# Cloudflare D1 (optional)
CF_ACCOUNT_ID=${D1_ACCOUNT}
CF_D1_DATABASE_ID=${D1_DB}
CF_API_TOKEN=${D1_TOKEN}
ENV
  umask 022
  ok ".env geschrieben"
else
  ok ".env vorhanden (neu einrichten: bash ${APP_DIR}/scripts/setup.sh --reconfigure)"
fi

step "Abhängigkeiten installieren"
(cd "${APP_DIR}" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
ok "npm-Pakete installiert"

fix_permissions
install_units

step "Bot starten"
systemctl restart ${SERVICE}
sleep 6
if systemctl is-active --quiet ${SERVICE}; then
  ok "Bot läuft!"
else
  warn "Bot läuft nicht – letzte Logzeilen:"
fi
journalctl -u ${SERVICE} -n 15 --no-pager -o cat || true

CLIENT_ID=$(grep -E '^CLIENT_ID=' "$ENV_FILE" | cut -d= -f2)
INVITE="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID:-$CLIENT_ID_DEFAULT}&scope=bot%20applications.commands&permissions=326417599488"
echo -e "
${c_green}════════════════════════════════════════════════════════════${c_off}
 ✅ Fertig! Der Bot aktualisiert sich ab jetzt automatisch aus GitHub.

 1. Bot einladen:  ${INVITE}
 2. In Discord:    /aufbau   → Forum + Highteam-Rollen wählen
 3. In Discord:    /panel    → Panel in einen privaten Kanal schicken

 Verwaltung auf dem Server:  bcpp-bot status | logs | restart | update | config
${c_green}════════════════════════════════════════════════════════════${c_off}"
