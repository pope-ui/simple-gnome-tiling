#!/bin/bash
# Simple Tiling Extension Installer

set -e

EXT_NAME="simple-tiling"
UUID="${EXT_NAME}@meister.local"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/${UUID}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🎯 Simple Tiling Extension Installer"
echo "====================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

check_dependencies() {
    echo -e "${BLUE}[1/5] Checking dependencies...${NC}"
    
    local missing=()
    for cmd in gnome-extensions glib-compile-schemas; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done
    
    if [ ${#missing[@]} -ne 0 ]; then
        echo -e "${RED}❌ Missing dependencies: ${missing[*]}${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ All dependencies found${NC}"
}

create_directories() {
    echo -e "${BLUE}[2/5] Creating directories...${NC}"
    
    mkdir -p "$EXT_DIR"
    mkdir -p "$EXT_DIR/schemas"
    
    echo -e "${GREEN}✅ Directory created: $EXT_DIR${NC}"
}

copy_files() {
    echo -e "${BLUE}[3/5] Copying files...${NC}"
    
    cp "$SCRIPT_DIR/metadata.json" "$EXT_DIR/"
    cp "$SCRIPT_DIR/extension.js" "$EXT_DIR/"
    cp "$SCRIPT_DIR/stylesheet.css" "$EXT_DIR/"
    cp "$SCRIPT_DIR/schemas/"*.xml "$EXT_DIR/schemas/"
    
    chmod +x "$EXT_DIR/extension.js"
    
    echo -e "${GREEN}✅ Files copied${NC}"
}

compile_schemas() {
    echo -e "${BLUE}[4/5] Compiling schemas...${NC}"
    
    glib-compile-schemas "$EXT_DIR/schemas/"
    
    echo -e "${GREEN}✅ Schemas compiled${NC}"
}

enable_extension() {
    echo -e "${BLUE}[5/5] Enabling extension...${NC}"
    
    gnome-extensions disable "$UUID" 2>/dev/null || true
    gnome-extensions enable "$UUID"
    
    echo -e "${GREEN}✅ Extension enabled${NC}"
}

finalize() {
    echo ""
    echo -e "${GREEN}======================================${NC}"
    echo -e "${GREEN}✅ Installation Complete!${NC}"
    echo -e "${GREEN}======================================${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "  1. Press ${YELLOW}Alt+F2${NC} and type ${YELLOW}'r'${NC} to reload GNOME Shell"
    echo "  2. Try the keyboard shortcuts:"
    echo "     • Super + H/J/K/L — Tile windows"
    echo "     • Super + Space — Toggle float"
    echo ""
    echo -e "${YELLOW}⚠️  Tip:${NC} If something breaks, run:"
    echo "    gnome-extensions disable $UUID"
    echo ""
}

main() {
    check_dependencies
    create_directories
    copy_files
    compile_schemas
    enable_extension
    finalize
}

# Run installer
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
