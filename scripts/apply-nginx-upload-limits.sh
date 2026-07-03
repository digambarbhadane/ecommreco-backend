#!/usr/bin/env bash
set -euo pipefail

# Run on the EC2 host (Ubuntu + nginx) as a user with sudo.
# Fixes 413 Request Entity Too Large for /report-imports/import-session/*/file uploads.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNIPPET_SRC="$ROOT/deploy/nginx/snippets/upload-limits.conf"
SNIPPET_DST="/etc/nginx/snippets/ecommreco-upload-limits.conf"

if [[ ! -f "$SNIPPET_SRC" ]]; then
  echo "Missing $SNIPPET_SRC — run from the backend repo after git pull." >&2
  exit 1
fi

sudo cp "$SNIPPET_SRC" "$SNIPPET_DST"

SITE_FILES=(/etc/nginx/sites-enabled/*)
UPDATED=0
for site in "${SITE_FILES[@]}"; do
  [[ -f "$site" ]] || continue
  if grep -q 'ecommreco-upload-limits.conf' "$site"; then
    echo "Already includes upload limits: $site"
    continue
  fi
  if grep -q 'api-dev\.ecommreco\.com\|api-uat\.ecommreco\.com\|api\.ecommreco\.com' "$site"; then
    echo "Patching $site — add upload limits include after first server { line"
    sudo sed -i '/server {/a\    include /etc/nginx/snippets/ecommreco-upload-limits.conf;' "$site"
    UPDATED=1
  fi
done

if [[ "$UPDATED" -eq 0 ]]; then
  echo "No site file was auto-patched."
  echo "Manually add this line inside the api-dev server block:"
  echo "    include /etc/nginx/snippets/ecommreco-upload-limits.conf;"
fi

sudo nginx -t
sudo systemctl reload nginx
echo "Nginx reloaded. client_max_body_size is now 100m for patched sites."
