#!/usr/bin/env bash

# require_not_root ensures the script is not run as root or with sudo.
# unless running in a container
require_not_root() {

  # skip this check if running in a container
  if [[ "${IN_CONTAINER_BUILD:-0}" == "1" ]]; then
    echo "🐳 Container build detected, skipping root check"
    return 0
  fi

  local uid
  uid="${EUID:-$(id -u)}"

  if [[ "$uid" -eq 0 ]]; then
    if [[ -n "${SUDO_USER:-}" ]]; then
      cat >&2 <<EOF
❌ This script was run with sudo.
   Re-run it without sudo:

     ${0##*/}
EOF
    else
      cat >&2 <<EOF
❌ This script is running as root.
   Please run it as a normal user.
EOF
    fi
    exit 1
  fi
}

# detect_arch detects the instruction set architecture (amd64, arm64, arm, 386)
# returns: amd64, arm64, arm, 386 or 1 if not detected
detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)   echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    armv7l|armv7*) echo arm ;;
    i386|i686)     echo 386 ;;
    *) return 1 ;;
  esac
}

# detect_os detects the operating system (linux, darwin, unknown)
# returns: linux, darwin or 1 if not known
detect_os() {
  case "$(uname -s)" in
    Linux*)     echo linux ;;
    Darwin*)    echo darwin ;;
    *)          return 1 ;;
  esac
}

# version_ge compares two semantic version strings
# returns 0 if $1 >= $2
version_ge() {
  [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# get the directory yq is installed into (not the path to the binary itself,
# PATH entries must be directories). YQ_INSTALL_DIR overrides the default.
get_yq_dir() {
  if [[ -n "${YQ_INSTALL_DIR:-}" ]]; then
    echo "$YQ_INSTALL_DIR"
    return 0
  fi

  local os
  os="$(detect_os)" || { echo "❌ Unsupported OS" >&2; return 1; }

  if [[ "$os" == "darwin" ]]; then
    # macOS path
    echo "/usr/local/bin"
  else
    # Linux path
    echo "$HOME/.local/bin"
  fi
}

# put yq on PATH in current shell
put_yq_on_path() {
  if command -v yq &> /dev/null; then
    return 0
  fi

  local dir
  dir="$(get_yq_dir)" || return 1

  # wrapping PATH in colons makes the match work for first and last entries too
  case ":$PATH:" in
    *":$dir:"*) ;;
    *) export PATH="$dir:$PATH" ;;
  esac
}
