#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_root="${GAMEBENCH_RELEASE_ROOT:-/srv/gamebench/releases}"
current_link="${GAMEBENCH_CURRENT_LINK:-/srv/gamebench/current}"
build_id="${GAMEBENCH_BUILD_ID:-$(git -C "$repository_root" rev-parse HEAD)}"
destination="$release_root/$build_id"

pnpm --dir "$repository_root" --filter @carrick/gamebench-site build
install -d "$destination"
rsync -a --delete "$repository_root/apps/site/dist/" "$destination/site/"
ln -sfn "$destination" "$current_link"

echo "Deployed static site build $build_id to $destination"
