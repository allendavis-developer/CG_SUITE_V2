#!/bin/zsh

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/frontend/vite-project"
STATIC="$ROOT/static/frontend"
TEMPLATE="$ROOT/pricing/templates/react.html"

echo "Building frontend..."
cd "$FRONTEND"
npm run build

echo "Copying to static/frontend/..."
rm -rf "$STATIC"
mkdir -p "$STATIC"
cp -r "$FRONTEND/dist/." "$STATIC/"

JS_FILE=$(ls "$STATIC/assets/"*.js | head -n 1 | xargs basename)
CSS_FILE=$(ls "$STATIC/assets/"*.css | head -n 1 | xargs basename)

echo "Detected: $JS_FILE, $CSS_FILE"

sed -i '' \
  "s|href=\"{% static 'frontend/assets/.*\.css' %}\"|href=\"{% static 'frontend/assets/$CSS_FILE' %}\"|g" \
  "$TEMPLATE"

sed -i '' \
  "s|src=\"{% static 'frontend/assets/.*\.js' %}\"|src=\"{% static 'frontend/assets/$JS_FILE' %}\"|g" \
  "$TEMPLATE"

echo "Done. Template updated with new asset filenames."
