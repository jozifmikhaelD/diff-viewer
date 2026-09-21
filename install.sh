#!/bin/sh
# Installs the latest diff-viewer release (the `void` binary) for macOS or Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/jozifmikhaelD/diff-viewer/main/install.sh | sh
#
# Environment overrides:
#   VOID_VERSION      release tag to install (default: latest), e.g. v0.1.0
#   VOID_INSTALL_DIR  directory to install into (default: /usr/local/bin if
#                     writable, otherwise ~/.local/bin)
set -eu

repo="jozifmikhaelD/diff-viewer"

os="$(uname -s)"
case "$os" in
  Darwin) os=darwin ;;
  Linux)  os=linux ;;
  *) echo "install.sh: unsupported OS: $os (macOS and Linux only)" >&2; exit 1 ;;
esac

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64)  arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "install.sh: unsupported architecture: $arch" >&2; exit 1 ;;
esac

command -v curl >/dev/null || { echo "install.sh: curl is required" >&2; exit 1; }
command -v tar  >/dev/null || { echo "install.sh: tar is required" >&2; exit 1; }

tag="${VOID_VERSION:-}"
if [ -z "$tag" ]; then
  tag="$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$tag" ] || { echo "install.sh: could not determine the latest release" >&2; exit 1; }
fi
version="${tag#v}"

archive="void_${version}_${os}_${arch}.tar.gz"
base="https://github.com/$repo/releases/download/$tag"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading void $tag for $os/$arch..."
curl -fsSL -o "$tmp/$archive" "$base/$archive"
curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt"

expected="$(grep " $archive\$" "$tmp/checksums.txt" | cut -d ' ' -f 1)"
if command -v sha256sum >/dev/null; then
  actual="$(sha256sum "$tmp/$archive" | cut -d ' ' -f 1)"
else
  actual="$(shasum -a 256 "$tmp/$archive" | cut -d ' ' -f 1)"
fi
[ "$expected" = "$actual" ] || { echo "install.sh: checksum mismatch for $archive" >&2; exit 1; }

tar -xzf "$tmp/$archive" -C "$tmp" void

dir="${VOID_INSTALL_DIR:-}"
if [ -z "$dir" ]; then
  if [ -w /usr/local/bin ]; then dir=/usr/local/bin; else dir="$HOME/.local/bin"; fi
fi
mkdir -p "$dir"
install -m 0755 "$tmp/void" "$dir/void"

echo "Installed $("$dir/void" -version) to $dir/void"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "Note: $dir is not on your PATH. Add it with:"
     echo "  export PATH=\"$dir:\$PATH\"" ;;
esac
echo "Run 'void .' inside any git repository to start."
