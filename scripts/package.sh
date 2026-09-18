#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f dist/index.js ]]; then
  echo "dist/index.js missing; run pnpm run build first" >&2
  exit 1
fi

STAGE="$ROOT/out/DeckDepot"
rm -rf "$STAGE"
mkdir -p "$STAGE/dist" "$STAGE/py_modules" "$STAGE/assets"

cp "$ROOT/plugin.json" "$ROOT/package.json" "$ROOT/main.py" "$ROOT/LICENSE" "$ROOT/README.md" "$STAGE/"
if [[ -f "$ROOT/CHANGELOG.md" ]]; then
  cp "$ROOT/CHANGELOG.md" "$STAGE/"
fi
cp "$ROOT/dist/index.js" "$STAGE/dist/"
cp -a "$ROOT/py_modules/deckdepot" "$STAGE/py_modules/"
find "$STAGE" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "$STAGE" -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete
# Spike harnesses live under spikes/ and must never ship.
rm -f "$STAGE/py_modules/deckdepot/"*{spike,contract,launch,schema}.py
if [[ -d "$ROOT/assets" ]]; then
  cp -a "$ROOT/assets/." "$STAGE/assets/"
fi

python3 - <<'PY'
import shutil
from pathlib import Path
root = Path.cwd()
out = root / "out"
archive = out / "DeckDepot"
shutil.make_archive(str(archive), "zip", root_dir=out, base_dir="DeckDepot")
print(archive.with_suffix(".zip"))
PY
