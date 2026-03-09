#!/bin/bash
# Build AppIcon.icns from icon-source.html
# Uses qlmanage (macOS built-in) to render HTML → PNG, then iconutil for .icns
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/icon-source.html"
ICONSET="$SCRIPT_DIR/AppIcon.iconset"
OUTPUT="$SCRIPT_DIR/AppIcon.icns"

echo "==> Rendering icon from $SRC"

# Clean up any previous iconset
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# --- Method: Extract SVG from HTML file and use rsvg-convert or qlmanage ---

# Extract just the SVG element from the HTML
SVG_FILE="$SCRIPT_DIR/icon-source.svg"
sed -n '/<svg/,/<\/svg>/p' "$SRC" > "$SVG_FILE"

# Try rsvg-convert first (best quality), fall back to qlmanage
if command -v rsvg-convert &>/dev/null; then
  echo "    Using rsvg-convert"
  RENDER_CMD="rsvg-convert"
elif command -v /opt/homebrew/bin/rsvg-convert &>/dev/null; then
  echo "    Using /opt/homebrew/bin/rsvg-convert"
  RENDER_CMD="/opt/homebrew/bin/rsvg-convert"
else
  RENDER_CMD=""
fi

# Render 1024px master PNG
MASTER_PNG="$SCRIPT_DIR/icon_1024.png"

if [ -n "$RENDER_CMD" ]; then
  "$RENDER_CMD" -w 1024 -h 1024 "$SVG_FILE" -o "$MASTER_PNG"
else
  echo "    Using qlmanage (fallback)"
  # qlmanage renders HTML to a thumbnail
  qlmanage -t -s 1024 -o "$SCRIPT_DIR" "$SRC" 2>/dev/null
  # qlmanage outputs as icon-source.html.png
  mv "$SCRIPT_DIR/icon-source.html.png" "$MASTER_PNG" 2>/dev/null || true
fi

if [ ! -f "$MASTER_PNG" ]; then
  echo "ERROR: Failed to render master PNG. Install librsvg: brew install librsvg"
  exit 1
fi

echo "==> Master PNG rendered: $MASTER_PNG"

# --- Generate all required icon sizes ---
# macOS .iconset requires these exact filenames:
SIZES=(16 32 64 128 256 512)

for size in "${SIZES[@]}"; do
  echo "    ${size}x${size}"
  sips -z "$size" "$size" "$MASTER_PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null 2>&1

  # @2x variants (double resolution)
  double=$((size * 2))
  if [ "$double" -le 1024 ]; then
    echo "    ${size}x${size}@2x (${double}px)"
    sips -z "$double" "$double" "$MASTER_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null 2>&1
  fi
done

# 512@2x is the 1024 master
echo "    512x512@2x (1024px)"
cp "$MASTER_PNG" "$ICONSET/icon_512x512@2x.png"

echo "==> Building .icns"
iconutil --convert icns --output "$OUTPUT" "$ICONSET"

echo "==> Done: $OUTPUT"
ls -lh "$OUTPUT"

# Cleanup
rm -f "$SVG_FILE" "$MASTER_PNG"
rm -rf "$ICONSET"
