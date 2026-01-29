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

# --- main ----------------------------------------------------------------

echo "🔧 Starting toolchain setup..."

# --- NVM INSTALL ---
if ! command -v nvm &> /dev/null; then
  echo "⬇️ Installing NVM..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

  # Load into current shell
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
else
  echo "✅ NVM already installed."
fi

# --- NODE 20.19.0 INSTALL ---
NODE_VERSION="20.19.0"

echo "⬇️ Installing Node.js $NODE_VERSION..."
nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"

echo "📦 Node.js version set to $(node -v)"

# --- REDOCLY CLI INSTALL ---
if ! command -v redocly &> /dev/null; then
  echo "⬇️ Installing Redocly CLI..."
  npm install -g @redocly/cli
else
  echo "✅ Redocly CLI already installed."
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

    echo "📦 Downloading yq ${VERSION} for ${OS}/${ARCH}..."
    curl -fL -o /usr/local/bin/yq \
      "https://github.com/mikefarah/yq/releases/download/${VERSION}/yq_${OS}_${ARCH}"
    chmod +x /usr/local/bin/yq
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