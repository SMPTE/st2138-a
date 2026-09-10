#!/usr/bin/env bash
#
# st2138.sh - local convenience wrapper for the st2138-a command line tools.
#
# Runs the tools CLI (tools/bin/cli.js) without a global npm install or npm link.
# Because npm only links a package's own bin when it is installed as a dependency
# (not from within the publishing repo), this wrapper provides the same
# ergonomics locally. Invoke from anywhere in the repo, e.g.:
#
#     ./st2138.sh validate examples/device.example.yaml
#
# readlink -f is used so the path resolves correctly even when the script is
# called via a symlink or from another directory.
exec node "$(dirname -- "$(readlink -f -- "$0")")/tools/bin/cli.js" "$@"
