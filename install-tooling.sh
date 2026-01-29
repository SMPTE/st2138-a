#!/usr/bin/env bash


# This script installs the tools used by build-openapi.sh
# and /tools/validator.js
# do not run as root


set -euo pipefail


# ensure script is not run as root or with sudo
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  if [[ -n "${SUDO_USER:-}" ]]; then
    echo "❌ This script was run with sudo."
    echo "   Re-run it without sudo:"
    echo
    echo "     $0"
  else
    echo "❌ This script is running as root."
    echo "   Please run it as a normal user."
  fi
  exit 1
fi

# --- helpers ------------------------------------------------------------

# detect the instruction set architecture (amd64, arm64, arm, 386)
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

# detect the operating system (linux, darwin, unknown)
# returns: linux, darwin or 1 if not known
detect_os() {
  case "$(uname -s)" in
    Linux*)     echo linux ;;
    Darwin*)    echo darwin ;;
    *)          return 1 ;;
  esac
}

# compare two semantic version strings
# returns 0 if $1 >= $2
version_ge() {
  [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# --- main ----------------------------------------------------------------

echo "🔧 Starting toolchain setup..."


# Install nvm if not already installed
# N.B. nvm is not a command, it's a script that needs to be sourced into the
# current shell to make the nvm command available.
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

# --- NODE 20.19.0 INSTALL ---
NODE_VERSION="20.19.0"

if command -v node >/dev/null 2>&1; then
  CURRENT_NODE_VERSION="$(node -v | sed 's/^v//')"
else
  CURRENT_NODE_VERSION=""
fi

if [ -z "$CURRENT_NODE_VERSION" ] || ! version_ge "$CURRENT_NODE_VERSION" "$NODE_VERSION"; then
  echo "⬇️ Installing Node.js $NODE_VERSION..."
  nvm install "$NODE_VERSION"
else
  echo "✅ Node.js $CURRENT_NODE_VERSION already satisfies >= $NODE_VERSION"
fi

# activate this version and ensure node is on PATH for the rest of the script
nvm use "$NODE_VERSION" >/dev/null
NODE_INST_DIR="$NVM_DIR/versions/node/v$NODE_VERSION"
if [ -d "$NODE_INST_DIR/bin" ]; then
  export PATH="$NODE_INST_DIR/bin:$PATH"
  hash -r
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

    # Decide which rc file to modify
    if [ -n "${ZSH_VERSION:-}" ]; then
      RC_FILE="$HOME/.zshrc"
    elif [ -n "${BASH_VERSION:-}" ]; then
      RC_FILE="$HOME/.bashrc"
    else
      RC_FILE=""
    fi

    # Persist PATH update if possible
    if [ -n "$RC_FILE" ]; then
      if ! grep -qs 'export PATH="$HOME/.local/bin:$PATH"' "$RC_FILE"; then
        echo "" >> "$RC_FILE"
        echo "# Added by yq installer" >> "$RC_FILE"
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$RC_FILE"
        echo "➕ Added ~/.local/bin to PATH in $(basename "$RC_FILE")"
      else
        echo "✅ ~/.local/bin already on PATH in $(basename "$RC_FILE")"
      fi
    else
      echo "⚠️ Could not determine shell rc file; PATH not persisted"
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