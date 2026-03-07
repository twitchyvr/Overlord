#!/usr/bin/env bash
# ================================================================
# watch.sh — Overlord port-3031 watchdog
# Run this in a separate iTerm2 tab. It starts the server, watches
# the process, and restarts automatically if it crashes or exits.
#
# Usage:  ./watch.sh
# Stop:   Ctrl-C (sends SIGINT to the watcher AND the server)
# ================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$DIR/.overlord/watchdog.log"
RESTART_DELAY=3        # seconds to wait before each restart
MAX_RESTARTS=20        # give up after this many crashes in a row
CRASH_WINDOW=10        # seconds — restarts within this window count as "rapid"

# ── colours ──────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ts()  { date '+%H:%M:%S'; }
log() { echo -e "$(ts)  $*"; }

# ── ensure log directory exists ──────────────────────────────────
mkdir -p "$DIR/.overlord"

# ── trap Ctrl-C so we can clean up the child ─────────────────────
SERVER_PID=""
cleanup() {
    echo ""
    log "${YELLOW}⚡ Watchdog stopping…${RESET}"
    if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        log "   Sending SIGTERM to server PID $SERVER_PID"
        kill -TERM "$SERVER_PID" 2>/dev/null
        # Give it 5 s to die gracefully before forcing it
        for _ in $(seq 1 10); do
            sleep 0.5
            kill -0 "$SERVER_PID" 2>/dev/null || break
        done
        kill -9 "$SERVER_PID" 2>/dev/null
    fi
    log "${YELLOW}   Watchdog exited.${RESET}"
    exit 0
}
trap cleanup INT TERM

# ── check for a process already bound to 3031 ────────────────────
port_in_use() {
    lsof -ti tcp:3031 &>/dev/null
}

# ── pretty header ─────────────────────────────────────────────────
clear
echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════╗"
echo "  ║   OVERLORD WATCHDOG — port 3031  ║"
echo "  ╚══════════════════════════════════╝"
echo -e "${RESET}"
log "Working dir : ${BOLD}$DIR${RESET}"
log "Log file    : ${BOLD}$LOG_FILE${RESET}"
log "Restart cap : ${BOLD}$MAX_RESTARTS restarts${RESET}"
echo ""

# ── warn if something else already owns 3031 ─────────────────────
if port_in_use; then
    EXISTING=$(lsof -ti tcp:3031)
    log "${YELLOW}⚠  Port 3031 is already in use by PID $EXISTING.${RESET}"
    log "   Kill it first, or the server will fail to bind."
    echo ""
fi

# ── main watchdog loop ───────────────────────────────────────────
run_count=0
rapid_count=0
last_start=0

while true; do
    run_count=$(( run_count + 1 ))
    now=$(date +%s)

    # Detect rapid-restart storm
    elapsed=$(( now - last_start ))
    if (( elapsed < CRASH_WINDOW )); then
        rapid_count=$(( rapid_count + 1 ))
    else
        rapid_count=1
    fi
    last_start=$now

    if (( rapid_count > MAX_RESTARTS )); then
        log "${RED}✖  Server crashed ${rapid_count} times in under ${CRASH_WINDOW}s.${RESET}"
        log "${RED}   Giving up — check ${LOG_FILE} for details.${RESET}"
        exit 1
    fi

    # ── launch ───────────────────────────────────────────────────
    if (( run_count == 1 )); then
        log "${GREEN}▶  Starting server (attempt #${run_count})…${RESET}"
    else
        log "${YELLOW}↺  Restarting server (attempt #${run_count}, rapid #${rapid_count})…${RESET}"
    fi

    # Run launcher.js; tee output to the log file while keeping it
    # visible in this tab. The process runs in the foreground so we
    # capture its PID and wait for it to exit.
    node "$DIR/launcher.js" 2>&1 | tee -a "$LOG_FILE" &
    # node pipes through tee, so track the node PID via the pipe
    SERVER_PID=$!

    # Wait for the tee/node pair to finish
    wait $SERVER_PID
    EXIT_CODE=$?
    SERVER_PID=""

    # ── post-exit handling ────────────────────────────────────────
    echo ""
    if (( EXIT_CODE == 0 )); then
        log "${YELLOW}●  Server exited cleanly (code 0). Restarting in ${RESTART_DELAY}s…${RESET}"
    else
        log "${RED}✖  Server exited with code ${EXIT_CODE}. Restarting in ${RESTART_DELAY}s…${RESET}"
    fi
    log "   Log: $LOG_FILE"
    echo ""

    sleep "$RESTART_DELAY"
done
