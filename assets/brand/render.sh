#!/usr/bin/env bash
# Rasterise the brand SVGs into the web and mobile apps.
# Needs resvg, ImageMagick 7 (magick) and, optionally, oxipng on PATH, e.g.
#   nix shell nixpkgs#resvg nixpkgs#imagemagick nixpkgs#oxipng -c assets/brand/render.sh
set -euo pipefail

brand=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$brand/../.." && pwd)
web=$root/apps/web
mobile=$root/apps/mobile/assets/images
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

png() { resvg -w "$3" -h "$3" "$brand/$1" "$2"; }

# Opaque square: the tile's corners filled with its own background.
opaque() {
    png "$1" "$tmp/o.png" "$3"
    magick "$tmp/o.png" -background "$4" -alpha remove -alpha off "PNG24:$2"
}

# Web
png icon-16.svg "$tmp/16.png" 16
png icon-29.svg "$tmp/32.png" 32
png icon.svg "$tmp/48.png" 48
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" "$web/src/app/favicon.ico"
opaque icon.svg "$web/src/app/apple-icon.png" 180 "#16181C"
png icon.svg "$web/public/icon-192.png" 192
png icon.svg "$web/public/icon-512.png" 512
png icon-maskable.svg "$web/public/icon-maskable-512.png" 512

# Mobile: iOS wants opaque squares; the system draws the corners.
opaque icon.svg "$mobile/icon.png" 1024 "#16181C"
opaque icon-dark.svg "$mobile/icon-dark.png" 1024 "#000000"
opaque icon-tinted.svg "$mobile/icon-tinted.png" 1024 "#000000"
png android/foreground.svg "$mobile/adaptive-icon.png" 1024
png android/monochrome.svg "$mobile/adaptive-icon-monochrome.png" 1024
png icon.svg "$mobile/splash-icon.png" 1024
png icon-dark.svg "$mobile/splash-icon-dark.png" 1024

if command -v oxipng >/dev/null; then
    oxipng -q -o 4 --strip safe "$web/src/app/apple-icon.png" "$web/public/"icon-*.png
    # Keep the app store icons as plain RGB rather than palette images.
    oxipng -q -o 4 --strip safe --nc "$mobile/"*.png
fi
