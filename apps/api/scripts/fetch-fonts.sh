#!/usr/bin/env bash
# Downloads NotoSansJP (OFL) for the PDF module's CJK (Japanese) glyphs.
# Place the .ttf at apps/api/assets/fonts/NotoSansJP-Regular.ttf so the
# PdfService auto-registers it; without it PDFs render with Latin-only glyphs.
#
# The Google Fonts hosted Noto Sans JP is split into many webfont subsets, so
# for a single static TTF we use the official release from the notofonts repo.
set -euo pipefail

OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/assets/fonts"
mkdir -p "$OUT_DIR"

URL="https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/09_NotoSansCJKjp.zip"
ZIP_TMP="$(mktemp)"
trap 'rm -f "$ZIP_TMP"' EXIT

echo "Downloading NotoSansCJKjp.zip…"
curl -fL "$URL" -o "$ZIP_TMP"

echo "Extracting NotoSansCJKjp-Regular.otf → NotoSansJP-Regular.ttf"
# pdfkit needs TTF (TrueType), but Noto CJK ships OTF/CFF only. pdfkit's
# fontkit does read OpenType (CFF) via registerFont, so we accept the .otf.
unzip -p "$ZIP_TMP" "*/OTF/Japanese/NotoSansCJKjp-Regular.otf" \
  > "$OUT_DIR/NotoSansJP-Regular.ttf"

echo "Saved to $OUT_DIR/NotoSansJP-Regular.ttf"
ls -lh "$OUT_DIR/NotoSansJP-Regular.ttf"