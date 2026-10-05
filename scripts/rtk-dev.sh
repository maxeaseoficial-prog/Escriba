#!/usr/bin/env bash
# Optional: the user-supplied RTK is a developer CLI, not a speech recognition engine.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .tools
if [[ ! -d .tools/rtk/.git ]]; then
  git clone --depth 1 https://github.com/rtk-ai/rtk.git .tools/rtk
fi
printf 'RTK source is in .tools/rtk. Original licenses and notices are preserved.\n'
printf 'Optional build (requires Rust): cargo build --release --manifest-path .tools/rtk/Cargo.toml\n'
printf 'Optional tests through RTK: .tools/rtk/target/release/rtk pytest -q\n'
