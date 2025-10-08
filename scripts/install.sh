#!/usr/bin/env bash
set -euo pipefail

platform=$(uname -ms)

case $platform in
'MINGW64'* | 'MSYS'* | 'CYGWIN'*)
    cat <<'EOF'
Windows installation is not supported yet. Please install via WSL or run:
  bun build src/cli.ts --compile --outfile ts-lsp-mcp
EOF
    exit 1
    ;;
esac

Color_Off=''
Red=''
Green=''
Dim=''
Bold_White=''
Bold_Green=''

if [[ -t 1 ]]; then
    Color_Off='\033[0m'
    Red='\033[0;31m'
    Green='\033[0;32m'
    Dim='\033[0;2m'
    Bold_Green='\033[1;32m'
    Bold_White='\033[1m'
fi

error() {
    echo -e "${Red}error${Color_Off}: $*" >&2
    exit 1
}

info() {
    echo -e "${Dim}$*${Color_Off}"
}

info_bold() {
    echo -e "${Bold_White}$*${Color_Off}"
}

success() {
    echo -e "${Green}$*${Color_Off}"
}

command -v unzip >/dev/null || error "unzip is required to install ts-lsp-mcp"
command -v curl >/dev/null || error "curl is required to install ts-lsp-mcp"
if ! command -v tsgo >/dev/null; then
    info "TypeScript native preview (tsgo) not found on PATH."
    info "Install it via npm or bun, for example:"
    info_bold "  npm install -g @typescript/native-preview"
    info_bold "  # or"
    info_bold "  bun add -g @typescript/native-preview"
fi

if [[ $# -gt 1 ]]; then
    error "Too many arguments. At most one version (e.g. \"v0.1.0\") may be provided."
fi

case $platform in
'Darwin x86_64')
    target=darwin-x64
    ;;
'Darwin arm64')
    target=darwin-arm64
    ;;
'Linux aarch64' | 'Linux arm64')
    target=linux-aarch64
    ;;
'Linux x86_64' | *)
    target=linux-x64
    ;;
esac

if [[ $target == linux-* && -f /etc/alpine-release ]]; then
    target="$target-musl"
fi

TS_LSP_MCP_GITHUB_OWNER=${TS_LSP_MCP_GITHUB_OWNER:-"cryogenic"}
TS_LSP_MCP_GITHUB_REPO=${TS_LSP_MCP_GITHUB_REPO:-"ts-lsp-mcp"}
TS_LSP_MCP_GITHUB_URL=${TS_LSP_MCP_GITHUB_URL:-"https://github.com"}
repo_url="$TS_LSP_MCP_GITHUB_URL/$TS_LSP_MCP_GITHUB_OWNER/$TS_LSP_MCP_GITHUB_REPO"

exe_name=ts-lsp-mcp

fetch_latest_tag() {
    curl --fail --silent \
        "https://api.github.com/repos/$TS_LSP_MCP_GITHUB_OWNER/$TS_LSP_MCP_GITHUB_REPO/releases/latest" \
        | grep -E '"tag_name"' \
        | head -n1 \
        | sed -E 's/.*"tag_name"\s*:\s*"([^\"]+)".*/\1/'
}

if [[ $# -eq 0 ]]; then
    info "Resolving latest release..."
    version=$(fetch_latest_tag || true)
    [[ -n ${version:-} ]] || error "Failed to resolve latest release tag. Specify a version manually."
else
    version=$1
fi

asset="ts-lsp-mcp-$target.zip"
asset_uri="$repo_url/releases/download/$version/$asset"

info "Installing ts-lsp-mcp $version for $target"

TS_LSP_MCP_HOME=${TS_LSP_MCP_HOME:-"$HOME/.ts-lsp-mcp"}
mkdir -p "$TS_LSP_MCP_HOME"

archive_path="$TS_LSP_MCP_HOME/$asset"
curl --fail --location --progress-bar --output "$archive_path" "$asset_uri" ||
    error "Failed to download asset from $asset_uri"

info "Extracting archive..."
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/ts-lsp-mcp.XXXXXX")
unzip -oqd "$tmp_dir" "$archive_path" ||
    error "Failed to extract archive"

if [[ ! -f "$tmp_dir/$exe_name" ]]; then
    error "Binary $exe_name not found in archive"
fi

install_path="$TS_LSP_MCP_HOME/$exe_name"
mv "$tmp_dir/$exe_name" "$install_path"
chmod +x "$install_path"
rm -rf "$tmp_dir" "$archive_path"

tildify() {
    local input=$1
    if [[ $input == "$HOME"* ]]; then
        echo "~${input#$HOME}"
    else
        echo "$input"
    fi
}

success "Installed ts-lsp-mcp to $(tildify "$install_path")"

PATH_SNIPPET="export TS_LSP_MCP_HOME=\"$TS_LSP_MCP_HOME\"\nexport PATH=\"\$TS_LSP_MCP_HOME:\$PATH\""

cat <<EOF

Add ts-lsp-mcp to your PATH if needed:

$PATH_SNIPPET

If you have not installed the TypeScript native preview yet, run:

  npm install -g @typescript/native-preview
  # or
  bun add -g @typescript/native-preview

Then run:

  ts-lsp-mcp --workspace /path/to/your/project

EOF
