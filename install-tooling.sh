#!/usr/bin/env bash


# This script installs the tools used by build-openapi.sh
# and /tools/validator.js


set -euo pipefail

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

  unameOut="$(uname -s)"
  case "${unameOut}" in
      Linux*)     OS=linux;;
      Darwin*)    OS=darwin;;
      *)          echo "❌ Unsupported OS: ${unameOut}"; exit 1;;
  esac

  ARCH=amd64
  VERSION=$(curl -s https://api.github.com/repos/mikefarah/yq/releases/latest | grep '"tag_name":' | cut -d'"' -f4)

  echo "📦 Downloading yq $VERSION for $OS/$ARCH..."
  curl -Lo /usr/local/bin/yq https://github.com/mikefarah/yq/releases/download/${VERSION}/yq_${OS}_${ARCH}
  chmod +x /usr/local/bin/yq
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