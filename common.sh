#!/usr/bin/env bash

# require_not_root ensures the script is not run as root or with sudo.
# unless running in a container
require_not_root() {

  # skip this check if running in a container
  if [ -f /.dockerenv ]; then
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

# get path to yq
get_yq_path() {
  if ! command -v yq &> /dev/null; then
    OS="$(detect_os)"   || { echo "❌ Unsupported OS"; exit 1; }

    if [[ "$OS" == "darwin" ]]; then
      # macOS path
      echo "/usr/local/bin/yq"
    else
      # Linux path
      echo "$HOME/.local/bin/yq"
    fi
  fi
}

# put yq on PATH in current shell
put_yq_on_path() {
  # Add to PATH for current shell
  if ! echo "$PATH" | grep -q "$(get_yq_path)"; then
    export PATH="$(get_yq_path):$PATH"
  fi
}