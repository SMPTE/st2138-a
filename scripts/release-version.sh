#!/usr/bin/env bash
#
# Single source of truth for the release version policy. The release workflows
# call this so the "what version comes next" rules live in exactly one place.
#
#   release-version.sh release  <version>
#       Turn a develop (dev) version into the version to publish by dropping a
#       trailing `.dev` or `-dev`.
#         v1.1.0-pre-fcd.dev -> v1.1.0-pre-fcd   (staged era)
#         v1.3.0-dev         -> v1.3.0           (post-full-release era)
#
#   release-version.sh next-dev <version>
#       Turn a just-published release version into the next develop version by
#       bumping the minor (patch -> 0), keeping the stage suffix, and
#       re-appending the dev marker.
#         v1.1.0-pre-fcd -> v1.2.0-pre-fcd.dev   (staged era)
#         v1.3.0         -> v1.4.0-dev           (post-full-release era)
#
# Versions are treated as opaque strings everywhere else in the toolchain
# (they are only ever a URL path segment and a tag-equality gate), so the
# staged form (e.g. -pre-fcd.dev sorting above -pre-fcd) never needs to obey
# semver precedence.
#
set -euo pipefail

cmd="${1:-}"
ver="${2:-}"
if [[ -z "$cmd" || -z "$ver" ]]; then
    echo "usage: $0 {release|next-dev} <version>" >&2
    exit 2
fi

case "$cmd" in
release)
    out="$(sed -E 's/[.-]dev$//' <<<"$ver")"
    if [[ "$out" == "$ver" ]]; then
        echo "error: '$ver' has no trailing .dev/-dev to strip; pass an explicit release version" >&2
        exit 1
    fi
    ;;
next-dev)
    # vMAJOR.MINOR.PATCH[-stage]; stage keeps its leading '-' (or is empty)
    if [[ ! "$ver" =~ ^(v?)([0-9]+)\.([0-9]+)\.([0-9]+)(-.+)?$ ]]; then
        echo "error: '$ver' is not vMAJOR.MINOR.PATCH[-stage]" >&2
        exit 1
    fi
    prefix="${BASH_REMATCH[1]}"
    major="${BASH_REMATCH[2]}"
    minor="${BASH_REMATCH[3]}"
    stage="${BASH_REMATCH[5]}"
    base="${prefix}${major}.$((minor + 1)).0${stage}"
    # a stage suffix already introduced the '-' prerelease, so extend it with
    # a dotted `.dev`; without one, `dev` is the whole prerelease via `-dev`
    if [[ -n "$stage" ]]; then
        out="${base}.dev"
    else
        out="${base}-dev"
    fi
    ;;
*)
    echo "usage: $0 {release|next-dev} <version>" >&2
    exit 2
    ;;
esac

printf '%s\n' "$out"
