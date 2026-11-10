#!/usr/bin/env bash
# Собирает статический сайт в _site/ для GitHub Pages.
# node_modules в git не попадает, поэтому копируем только нужные файлы
# three.js по тем же путям, что указаны в import map в 3d.html.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf _site
mkdir -p _site/node_modules/three/build _site/node_modules/three/examples/jsm/controls
cp index.html 3d.html _site/
cp -r css js _site/
cp node_modules/three/build/three.module.js node_modules/three/build/three.core.js \
  _site/node_modules/three/build/
cp node_modules/three/examples/jsm/controls/OrbitControls.js \
  _site/node_modules/three/examples/jsm/controls/
cp node_modules/three/LICENSE _site/node_modules/three/
echo "Сайт собран в _site/ ($(du -sh _site | cut -f1))"
