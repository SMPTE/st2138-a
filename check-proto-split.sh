#!/usr/bin/env bash
#
# check-proto-split.sh
#
# Enforce a clean separation between RPC service definitions and message/enum
# definitions: any .proto that declares a `service` must not also declare a
# `message` or `enum`.
#
# Why: keeping service definitions in their own file lets language bindings
# isolate the generated RPC/stub code from the plain data types. Several
# generators (e.g. Go's protoc-gen-go vs protoc-gen-go-grpc) emit the service
# stubs -- which pull in a gRPC runtime -- separately from the message types.
# When a file mixes the two, consumers that only need the messages are forced
# to link the gRPC runtime as well. Splitting services into dedicated files
# keeps that boundary intact for every binding.
#
# This is a fast, dependency-free lint. It is intentionally strict: a service
# file must contain no top-level message/enum declarations at all.
#
# Usage: ./check-proto-split.sh [PROTO_DIR]   (default: interface/proto)

set -euo pipefail

PROTO_DIR="${1:-interface/proto}"

if [[ ! -d "$PROTO_DIR" ]]; then
  echo "check-proto-split: proto directory not found: $PROTO_DIR" >&2
  exit 2
fi

status=0
shopt -s nullglob
protos=("$PROTO_DIR"/*.proto)

if [[ ${#protos[@]} -eq 0 ]]; then
  echo "check-proto-split: no .proto files found in $PROTO_DIR" >&2
  exit 2
fi

for f in "${protos[@]}"; do
  # Match top-level keyword declarations only (a keyword at the start of a line,
  # ignoring leading whitespace). Field types reference a message by name and
  # never repeat the `message`/`enum`/`service` keyword, so this does not
  # false-positive on usages. Commented-out lines (`// service ...`) are skipped
  # because the leading `//` prevents the anchor from matching.
  has_service=$(grep -cE '^[[:space:]]*service[[:space:]]+[A-Za-z_]' "$f" || true)
  has_type=$(grep -cE '^[[:space:]]*(message|enum)[[:space:]]+[A-Za-z_]' "$f" || true)

  if [[ "$has_service" -gt 0 && "$has_type" -gt 0 ]]; then
    echo "ERROR: $f declares a service alongside message/enum definitions."
    echo "       Move the service into its own .proto file; service definitions"
    echo "       must not share a file with message or enum declarations."
    status=1
  fi
done

if [[ "$status" -eq 0 ]]; then
  echo "check-proto-split: OK -- no file mixes a service with message/enum declarations."
fi

exit "$status"
