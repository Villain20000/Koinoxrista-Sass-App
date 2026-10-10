#!/usr/bin/env bash
# Re-downloads the Noto Sans (SIL OFL 1.1) fonts used by the PDF module for
# Greek glyphs (ειδοποιητήρια / καταστάσεις). The fonts are already committed
# under apps/api/src/assets/fonts; run this only to refresh them.
set -euo pipefail

OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/assets/fonts"
mkdir -p "$OUT_DIR"
BASE="https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf"
for weight in Regular Bold; do
  curl -fsSL -o "$OUT_DIR/NotoSans-$weight.ttf" "$BASE/NotoSans-$weight.ttf"
done
curl -fsSL -o "$OUT_DIR/OFL.txt" \
  "https://raw.githubusercontent.com/notofonts/latin-greek-cyrillic/main/OFL.txt"
echo "Fonts written to $OUT_DIR"
