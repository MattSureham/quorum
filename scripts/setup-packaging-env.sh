#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TOOLS="$ROOT/.tools"
mkdir -p "$TOOLS"

export BUN_INSTALL="$TOOLS/bun"
export RUSTUP_HOME="$TOOLS/rustup"
export CARGO_HOME="$TOOLS/cargo"
export PATH="$BUN_INSTALL/bin:$CARGO_HOME/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  echo "[setup] installing Bun into $BUN_INSTALL"
  curl -fsSL https://bun.sh/install | bash
else
  echo "[setup] Bun already available: $(command -v bun)"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "[setup] installing Rust toolchain into $CARGO_HOME / $RUSTUP_HOME"
  curl -fsSL https://sh.rustup.rs -o "$TOOLS/rustup-init.sh"
  sh "$TOOLS/rustup-init.sh" -y --no-modify-path --profile minimal --default-toolchain stable
else
  echo "[setup] Cargo already available: $(command -v cargo)"
fi

cat > "$TOOLS/packaging-env.sh" <<EOF
export BUN_INSTALL="$BUN_INSTALL"
export RUSTUP_HOME="$RUSTUP_HOME"
export CARGO_HOME="$CARGO_HOME"
export PATH="\$BUN_INSTALL/bin:\$CARGO_HOME/bin:\$PATH"
EOF

echo "[setup] packaging env written to $TOOLS/packaging-env.sh"
echo "[setup] versions:"
bun --version
cargo --version
rustc --version
