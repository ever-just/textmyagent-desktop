#!/usr/bin/env bash
#
# TextMyAgent Complete Uninstaller
# App ID: com.textmyagent.desktop | Product Name: TextMyAgent
#
# This script removes ALL artifacts from an installed TextMyAgent.app (DMG install).
# Run with: bash scripts/uninstall-textmyagent.sh
# Add --dry-run to preview without deleting anything.
#

set -uo pipefail

APP_ID="com.textmyagent.desktop"
APP_NAME="TextMyAgent"
BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo -e "${YELLOW}${BOLD}=== DRY RUN MODE — nothing will be deleted ===${NC}\n"
fi

removed=0
skipped=0

remove_path() {
  local target="$1"
  local description="$2"
  if [[ -e "$target" || -d "$target" ]]; then
    echo -e "${RED}  ✗ Removing${NC} $description"
    echo "    → $target"
    if [[ "$DRY_RUN" == false ]]; then
      rm -rf "$target"
    fi
    removed=$((removed + 1))
  else
    echo -e "${GREEN}  ✓ Already clean:${NC} $description"
    skipped=$((skipped + 1))
  fi
}

echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  TextMyAgent Complete Uninstaller${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo ""

# ─── 0. Quit the app if running ───────────────────────────────────────────────
echo -e "${BOLD}[0/8] Quitting TextMyAgent if running...${NC}"
if pgrep -f "TextMyAgent" > /dev/null 2>&1; then
  echo "  Sending quit signal..."
  if [[ "$DRY_RUN" == false ]]; then
    osascript -e 'quit app "TextMyAgent"' 2>/dev/null || true
    sleep 2
    # Force kill if still running
    pkill -f "TextMyAgent" 2>/dev/null || true
  fi
  echo -e "${RED}  ✗ Quit TextMyAgent${NC}"
else
  echo -e "${GREEN}  ✓ Not running${NC}"
fi
echo ""

# ─── 1. Application bundle ────────────────────────────────────────────────────
echo -e "${BOLD}[1/8] Application bundle...${NC}"
remove_path "/Applications/TextMyAgent.app" "Application bundle"
echo ""

# ─── 2. User data (database, encrypted secrets, Electron internals) ──────────
echo -e "${BOLD}[2/8] User data (database, API keys, Electron storage)...${NC}"
remove_path "$HOME/Library/Application Support/${APP_NAME}" "User data directory (textmyagent.db, secure-data.enc, LocalStorage, etc.)"
echo ""

# ─── 3. Caches ────────────────────────────────────────────────────────────────
echo -e "${BOLD}[3/8] Caches...${NC}"
remove_path "$HOME/Library/Caches/${APP_ID}" "App cache (by bundle ID)"
remove_path "$HOME/Library/Caches/${APP_ID}.ShipIt" "Electron auto-updater cache"
remove_path "$HOME/Library/Caches/${APP_NAME}" "App cache (by product name)"
remove_path "$HOME/Library/HTTPStorages/${APP_ID}" "HTTP storage"
remove_path "$HOME/Library/WebKit/${APP_ID}" "WebKit storage"
echo ""

# ─── 4. Preferences ──────────────────────────────────────────────────────────
echo -e "${BOLD}[4/8] Preferences...${NC}"
remove_path "$HOME/Library/Preferences/${APP_ID}.plist" "Preferences plist"
# Also flush the cfprefsd cache
if [[ "$DRY_RUN" == false ]]; then
  defaults delete "$APP_ID" 2>/dev/null || true
fi
echo "  Flushed cfprefsd cache for ${APP_ID}"
echo ""

# ─── 5. Saved state, logs, crash reports ──────────────────────────────────────
echo -e "${BOLD}[5/8] Saved state, logs, crash reports...${NC}"
remove_path "$HOME/Library/Saved Application State/${APP_ID}.savedState" "Saved application state"
remove_path "$HOME/Library/Logs/${APP_NAME}" "Application logs"
# Crash reports (both legacy and modern locations)
for report in "$HOME/Library/Logs/DiagnosticReports/${APP_NAME}"*; do
  if [[ -e "$report" ]]; then
    remove_path "$report" "Crash report: $(basename "$report")"
  fi
done
for report in "/Library/Logs/DiagnosticReports/${APP_NAME}"*; do
  if [[ -e "$report" ]]; then
    remove_path "$report" "System crash report: $(basename "$report")"
  fi
done
echo ""

# ─── 6. Keychain entries (Electron safeStorage) ──────────────────────────────
echo -e "${BOLD}[6/8] Keychain entries (Electron safeStorage)...${NC}"
echo "  Searching for keychain entries..."
KC_ENTRIES=""
security find-generic-password -l "${APP_NAME}" &>/dev/null && KC_ENTRIES="found"
KC_ENTRIES2=""
security find-generic-password -s "${APP_ID}" &>/dev/null && KC_ENTRIES2="found"
KC_ENTRIES3=""
security find-generic-password -l "${APP_NAME} Safe Storage" &>/dev/null && KC_ENTRIES3="found"

if [[ -n "$KC_ENTRIES" || -n "$KC_ENTRIES2" || -n "$KC_ENTRIES3" ]]; then
  echo -e "${RED}  ✗ Found keychain entries — removing...${NC}"
  if [[ "$DRY_RUN" == false ]]; then
    security delete-generic-password -l "${APP_NAME}" 2>/dev/null || true
    security delete-generic-password -s "${APP_ID}" 2>/dev/null || true
    security delete-generic-password -l "${APP_NAME} Safe Storage" 2>/dev/null || true
    # Electron's safeStorage typically uses "<productName> Safe Storage"
    security delete-generic-password -s "${APP_NAME} Safe Storage" 2>/dev/null || true
  fi
else
  echo -e "${GREEN}  ✓ No keychain entries found${NC}"
fi
echo ""

# ─── 7. DMG and downloaded installer files ───────────────────────────────────
echo -e "${BOLD}[7/8] Downloaded DMG / ZIP files...${NC}"
DMG_FOUND=false
for f in "$HOME/Downloads/TextMyAgent"*.dmg "$HOME/Downloads/textmyagent"*.dmg \
         "$HOME/Downloads/TextMyAgent"*.zip "$HOME/Downloads/textmyagent"*.zip \
         "$HOME/Desktop/TextMyAgent"*.dmg "$HOME/Desktop/textmyagent"*.dmg; do
  if [[ -e "$f" ]]; then
    remove_path "$f" "Downloaded installer: $(basename "$f")"
    DMG_FOUND=true
  fi
done
# Also detach any mounted DMG volumes
if mount | grep -qi "TextMyAgent" 2>/dev/null; then
  MOUNT_POINT=$(mount | grep -i "TextMyAgent" | awk '{print $3}')
  echo -e "${RED}  ✗ Detaching mounted DMG volume: ${MOUNT_POINT}${NC}"
  if [[ "$DRY_RUN" == false ]]; then
    hdiutil detach "$MOUNT_POINT" -force 2>/dev/null || true
  fi
fi
if [[ "$DMG_FOUND" == false ]]; then
  echo -e "${GREEN}  ✓ No DMG/ZIP files found in Downloads or Desktop${NC}"
fi
echo ""

# ─── 8. macOS privacy/permission entries (TCC) ───────────────────────────────
echo -e "${BOLD}[8/8] macOS privacy & permission entries...${NC}"
echo -e "${YELLOW}  ⚠  The following permissions must be removed MANUALLY in System Settings:${NC}"
echo ""
echo "  1. ${BOLD}Full Disk Access${NC}"
echo "     → System Settings > Privacy & Security > Full Disk Access"
echo "     → Find and remove \"TextMyAgent\""
echo ""
echo "  2. ${BOLD}Contacts${NC}"
echo "     → System Settings > Privacy & Security > Contacts"
echo "     → Find and remove \"TextMyAgent\""
echo ""
echo "  3. ${BOLD}Automation${NC} (Apple Events → Messages.app)"
echo "     → System Settings > Privacy & Security > Automation"
echo "     → Find and remove \"TextMyAgent\""
echo ""
echo "  4. ${BOLD}Accessibility${NC} (if granted)"
echo "     → System Settings > Privacy & Security > Accessibility"
echo "     → Check for and remove \"TextMyAgent\""
echo ""
echo "  Tip: You can also run this to reset ALL TCC decisions for the app:"
echo -e "  ${BOLD}tccutil reset All ${APP_ID}${NC}"
echo ""
if [[ "$DRY_RUN" == false ]]; then
  read -p "  Would you like to reset TCC permissions now? (y/N): " tcc_answer
  if [[ "$tcc_answer" =~ ^[Yy]$ ]]; then
    tccutil reset All "$APP_ID" 2>/dev/null || echo "  (tccutil returned non-zero — some entries may not exist)"
    echo -e "${RED}  ✗ TCC permissions reset for ${APP_ID}${NC}"
  else
    echo "  Skipped TCC reset."
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Uninstall Summary${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "  Items removed:  ${RED}${removed}${NC}"
echo -e "  Already clean:  ${GREEN}${skipped}${NC}"
echo ""
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${YELLOW}  This was a DRY RUN. Re-run without --dry-run to actually delete.${NC}"
else
  echo -e "${GREEN}  ✓ TextMyAgent has been completely removed from this Mac.${NC}"
  echo -e "  ${YELLOW}Don't forget to manually check System Settings for leftover permissions (step 8).${NC}"
fi
echo ""
