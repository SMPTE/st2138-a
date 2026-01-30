#!/usr/bin/env bash

# This script installs the tools used by build-openapi.sh
# and /tools/validator.js
# do not run as root

set -euo pipefail

# source the common.sh script, the -- tells cd and dirname that everything that
# follows is data, not options.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# fail fast if running as root or with sudo
require_not_root || exit 1

load_nvm() {
  echo "⬇️ Checking nvm..."
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # Installed: load it
    . "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
  fi

  if type nvm >/dev/null 2>&1; then
    echo "✅ NVM already installed & loaded."
  else
    echo "⬇️ Installing nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

    # Load into current shell
    . "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"

    # Optional: fail fast if something went wrong
    type nvm >/dev/null 2>&1 || { echo "❌ nvm install succeeded but nvm failed to load"; exit 1; }
  fi
}

echo "🔧 Starting toolchain setup..."
NODE_VERSION="20.19.0"

if command -v node >/dev/null 2>&1; then
  CURRENT_NODE_VERSION="$(node -v | sed 's/^v//')"
else
  CURRENT_NODE_VERSION=""
fi

if [ -z "$CURRENT_NODE_VERSION" ] || ! version_ge "$CURRENT_NODE_VERSION" "$NODE_VERSION"; then
  load_nvm
  echo "⬇️ Installing Node.js $NODE_VERSION..."
  nvm install "$NODE_VERSION"
  # activate this version and ensure node is on PATH for the rest of the script
  nvm use "$NODE_VERSION" >/dev/null
  NODE_INST_DIR="$NVM_DIR/versions/node/v$NODE_VERSION"
  if [ -d "$NODE_INST_DIR/bin" ]; then
    export PATH="$NODE_INST_DIR/bin:$PATH"
    hash -r
  fi
else
  echo "✅ Node.js $CURRENT_NODE_VERSION already satisfies >= $NODE_VERSION"
fi

# final sanity check
command -v node >/dev/null 2>&1 || { echo "❌ node not found after nvm use + PATH patch"; exit 1; }

echo "📦 Node.js version set to $(node -v)"


# --- REDOCLY CLI INSTALL ---
if nvm exec "$NODE_VERSION" redocly --version >/dev/null 2>&1; then
  echo "✅ Redocly CLI already installed."
else
  echo "⬇️ Installing Redocly CLI..."
  nvm exec "$NODE_VERSION" npm install -g @redocly/cli
fi

# --- YQ INSTALL ---
if ! command -v yq &> /dev/null; then
  echo "⬇️ Installing yq..."

  OS="$(detect_os)"   || { echo "❌ Unsupported OS"; exit 1; }
  ARCH="$(detect_arch)" || { echo "❌ Unsupported ARCH"; exit 1; }

  if [[ "$OS" == "darwin" ]]; then
    if ! command -v brew &> /dev/null; then
      echo "❌ Homebrew not found. Install brew first."
      exit 1
    fi

    echo "🍺 Installing yq via Homebrew..."
    brew install yq

  else
    # Linux path
    VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
      https://github.com/mikefarah/yq/releases/latest | sed 's|.*/tag/||')"

    INSTALL_DIR="$HOME/.local/bin"

    echo "📦 Downloading yq ${VERSION} for ${OS}/${ARCH}..."

    mkdir -p "$INSTALL_DIR"

    curl -fL -o "$INSTALL_DIR/yq" \
      "https://github.com/mikefarah/yq/releases/download/${VERSION}/yq_${OS}_${ARCH}"

    chmod +x "$INSTALL_DIR/yq"

    # --- PATH handling ------------------------------------------------------

    # Add to PATH for current shell
    if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
      export PATH="$INSTALL_DIR:$PATH"
    fi

  fi

else
  echo "✅ yq already installed."
fi

# --- DONE ---
echo ""
echo "🎉 Toolchain is ready:"
echo "• Node.js: $(node -v)"
echo "• npm:     $(npm -v)"
echo "• redocly: $(redocly --version)"
echo "• yq:      $(yq --version)"