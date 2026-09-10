#!/usr/bin/env bash
set -euo pipefail

# Run on the EC2 host (Ubuntu + nginx) as a user with sudo.
# Fixes 413 Request Entity Too Large for /report-imports/import-session/*/file uploads.

SNIPPET_NAME="ecommreco-upload-limits.conf"
SNIPPET_DST="/etc/nginx/snippets/${SNIPPET_NAME}"
INCLUDE_LINE="include /etc/nginx/snippets/${SNIPPET_NAME};"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNIPPET_SRC="$ROOT/deploy/nginx/snippets/upload-limits.conf"

if [[ ! -f "$SNIPPET_SRC" ]]; then
  echo "Missing $SNIPPET_SRC — run from the backend repo after git pull." >&2
  exit 1
fi

echo "==> Installing upload limits snippet"
sudo mkdir -p /etc/nginx/snippets
sudo cp "$SNIPPET_SRC" "$SNIPPET_DST"

patch_site_file() {
  local site="$1"
  if grep -q "$SNIPPET_NAME" "$site"; then
    echo "    Already patched: $site"
    return 0
  fi
  echo "    Patching every server block in: $site"
  # Add include after each "server {" so HTTPS blocks get the limit too.
  sudo sed -i "/server {/a\\    ${INCLUDE_LINE}" "$site"
}

echo "==> Patching site configs in /etc/nginx/sites-enabled/"
UPDATED=0
shopt -s nullglob
for site in /etc/nginx/sites-enabled/*; do
  [[ -f "$site" ]] || continue
  if grep -qE 'api-dev\.ecommreco\.com|api-uat\.ecommreco\.com|api\.ecommreco\.com|127\.0\.0\.1:5001|proxy_pass' "$site"; then
    patch_site_file "$site"
    UPDATED=1
  fi
done

if [[ "$UPDATED" -eq 0 ]]; then
  echo "WARN: No site file matched. Applying global limit in /etc/nginx/nginx.conf"
  if grep -q 'client_max_body_size' /etc/nginx/nginx.conf; then
    sudo sed -i 's/^[[:space:]]*client_max_body_size.*/    client_max_body_size 100m;/' /etc/nginx/nginx.conf
  else
    sudo sed -i '/http {/a\    client_max_body_size 100m;' /etc/nginx/nginx.conf
  fi
fi

echo "==> Testing nginx config"
sudo nginx -t

echo "==> Reloading nginx"
sudo systemctl reload nginx

echo ""
echo "Done. Current client_max_body_size settings:"
sudo nginx -T 2>/dev/null | grep -i client_max_body_size || true
echo ""
echo "Retry the file upload from https://dev.ecommreco.com"
