#!/usr/bin/env bash
#
# Local post-releaser. Run this after the release PR has merged into main. From
# the release/<version> branch it tags the release commit (which triggers the
# Publish workflow), then bumps VERSION to the next dev version, rebuilds the
# generated artifacts, commits, and pushes the branch, and finally prints the
# compare URL to open the back-merge PR into develop yourself.
#
# As with release.sh, opening the PR by hand is deliberate so the pull_request
# checks run. Deleting the release branch after that PR merges is also left to
# you (the printed instructions include the command).
#
# Usage:
#   scripts/post-release.sh [-y] [next-version]
#     -y             Skip the confirmation prompt before tagging/pushing.
#     next-version   Explicit next dev version. If omitted, it is derived from
#                    the release version via release-version.sh next-dev.
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

assume_yes=0
while getopts ":y" opt; do
    case "$opt" in
    y) assume_yes=1 ;;
    *)
        echo "usage: $0 [-y] [next-version]" >&2
        exit 2
        ;;
    esac
done
shift $((OPTIND - 1))
INPUT_NEXT="${1:-}"

die() {
    echo "error: $*" >&2
    exit 1
}

# Must be on a clean release/* branch that matches the remote.
[[ -z "$(git status --porcelain)" ]] ||
    die "working tree is dirty; commit or stash first"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == release/* ]] ||
    die "run this from the release/<version> branch (currently on '$BRANCH')"

git fetch --quiet origin "$BRANCH" main --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$BRANCH")" ]] ||
    die "local $BRANCH is not in sync with origin/$BRANCH; pull/push first"

RELEASE="$(tr -d '[:space:]' < VERSION)"
[[ "$BRANCH" == "release/$RELEASE" ]] ||
    die "branch '$BRANCH' does not match VERSION '$RELEASE'"

# Find the merge commit on main that brought this release in (its second parent
# is our release tip). This locates the exact commit to tag AND enforces the
# "merge commit only" rule: a squash/rebase merge produces no such commit.
release_sha="$(git rev-parse HEAD)"
merge_sha="$(git rev-list --merges --parents origin/main |
    awk -v r="$release_sha" '$2 == r || $3 == r { print $1; exit }')"
[[ -n "$merge_sha" ]] ||
    die "no merge commit for '$BRANCH' found on main; merge the release PR with a merge commit first"

# The tag is created here, so it must not exist yet.
if git rev-parse -q --verify "refs/tags/$RELEASE" >/dev/null ||
    git ls-remote --exit-code --tags origin "refs/tags/$RELEASE" >/dev/null 2>&1; then
    die "tag '$RELEASE' already exists; delete it before re-running"
fi

if [[ -n "$INPUT_NEXT" ]]; then
    NEXT="$INPUT_NEXT"
else
    NEXT="$(bash ./scripts/release-version.sh next-dev "$RELEASE")"
fi

echo "Tagging '$RELEASE', then bumping '$BRANCH' to next dev '$NEXT'."
if [[ "$assume_yes" -ne 1 ]]; then
    read -r -p "Tag '$RELEASE' (publishes it) and push the bump to '$BRANCH'? [y/N] " reply </dev/tty
    [[ "$reply" == [yY] || "$reply" == [yY][eE][sS] ]] || die "aborted"
fi

# Tag the merge commit on main (we're on the release branch, so name it
# explicitly) and push the tag to trigger Publish.
git tag -a "$RELEASE" -m "Release $RELEASE" "$merge_sha"
git push origin "$RELEASE"

printf '%s\n' "$NEXT" > VERSION
bash ./scripts/set-version.sh
bash ./build-openapi.sh
git add -A
git commit -m "Begin $NEXT development"
git push origin "$BRANCH"

slug="$(git remote get-url origin | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##')"

cat <<EOF

Tagged '$RELEASE' (Publish is building it) and pushed the bump to '$BRANCH'.
Now open the back-merge PR yourself so CI runs:

  https://github.com/$slug/compare/develop...$BRANCH?expand=1

  Base: develop   Compare: $BRANCH   Title: Begin $NEXT development

Merge it with "Create a merge commit" — NOT squash or rebase.
After it merges, delete the release branch yourself:

  git push origin --delete $BRANCH
EOF
