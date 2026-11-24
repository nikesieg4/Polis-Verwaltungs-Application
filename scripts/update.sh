#!/usr/bin/env bash
# Holt Updates aus GitHub und startet den Bot neu (läuft automatisch alle 5 Minuten).
#   bash update.sh          nur wenn es Änderungen gibt
#   bash update.sh --force  immer neu installieren + neustarten
set -euo pipefail

main() {
  local dir branch local_rev remote_rev
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$dir"
  branch="$(git rev-parse --abbrev-ref HEAD)"

  git fetch --quiet origin "$branch"
  local_rev="$(git rev-parse HEAD)"
  remote_rev="$(git rev-parse FETCH_HEAD)"

  if [[ $local_rev == "$remote_rev" && ${1:-} != "--force" ]]; then
    echo "Bereits aktuell ($(git rev-parse --short HEAD))."
    return 0
  fi

  echo "Update ${local_rev:0:7} → ${remote_rev:0:7} …"
  git reset --quiet --hard FETCH_HEAD   # .env und data/ sind von Git ausgeschlossen und bleiben erhalten
  npm ci --omit=dev --no-audit --no-fund --loglevel=error
  bash "$dir/scripts/setup.sh" --units-only >/dev/null
  systemctl restart bcpp-bot
  echo "✅ Aktualisiert auf $(git log -1 --format='%h – %s')"
}

# In einer Funktion, damit das Skript sich während "git reset" selbst ersetzen darf
main "$@"
exit $?
