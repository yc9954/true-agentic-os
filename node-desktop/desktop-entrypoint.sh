#!/usr/bin/env bash
# Boots a real DESKTOP (wallpaper + panel + a windowed terminal running Claude
# Code) over noVNC. The display resizes to each pane (resizeSession); a change-
# detecting loop refits the wallpaper + terminal so there's no flicker/redraw
# garbling. UTF-8 everywhere so the TUI's box-drawing glyphs render correctly.
set -e
export HOME=/home/node USER=node DISPLAY=:1 LANG=C.UTF-8 LC_ALL=C.UTF-8
NODE_NAME="${NODE_NAME:-node}"
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-haiku-4-5-20251001}"
mkdir -p ~/.claude ~/work ~/.config/openbox

# --- seed each node with a DISTINCT role + local data, so the orchestrator can
#     distribute genuinely different KINDS of work (file search / web / analysis) ---
if [ ! -f ~/work/.seeded ]; then
  case "$NODE_NAME" in
    node-1)  # local document store -> file search
      mkdir -p ~/work/docs
      cat > ~/work/docs/roadmap.md <<'EOF'
# Product roadmap (internal)
Q3: ship the multi-agent orchestrator beta; improve onboarding.
Q4: enterprise SSO, audit logs, self-hosted/on-prem option.
EOF
      cat > ~/work/docs/notes.md <<'EOF'
# Team notes
- Customers repeatedly ask for a self-hosted option (data residency).
- Top churn reason last quarter: setup complexity.
- Sales wants a clear comparison vs competitors.
EOF
      cat > ~/work/docs/incidents.md <<'EOF'
# Incidents
- Week 6: 3-hour API outage (EMEA); postmortem done, no data loss.
- Added rate-limit alerting afterwards.
EOF
      cat > ~/work/ROLE.txt <<'EOF'
ROLE: Local knowledge base. Search the files under ./docs to answer questions
about our internal plans, team notes, and incident history.
EOF
      # a training dataset that lives ONLY on this machine (x,y ~ y=3x+5 + noise)
      { echo "x,y"; for x in $(seq 1 30); do echo "$x,$((3 * x + 5 + (RANDOM % 5 - 2)))"; done; } > ~/work/dataset.csv
;;
    node-2)  # web research station -> web browsing
      cat > ~/work/ROLE.txt <<'EOF'
ROLE: Web-research station with live internet access.
Use WebSearch / WebFetch to gather current market, competitor, and news
intelligence. There are no local datasets here — your job is to look things up
online.
EOF
;;
    node-3)  # analytics node -> data analysis
      cat > ~/work/metrics.csv <<'EOF'
region,revenue_usd_m,qoq_growth_pct,headcount
Americas,4.2,12,38
EMEA,2.1,5,21
APAC,1.8,20,14
EOF
      cat > ~/work/ROLE.txt <<'EOF'
ROLE: Analytics node. Analyze the local metrics in ./metrics.csv (revenue,
growth, headcount by region) and compute totals / rankings on request.
EOF
;;
  esac
  touch ~/work/.seeded
fi

# --- Claude Code auth + onboarding ---
if [ -f /tmp/claude-credentials.json ]; then
  cp /tmp/claude-credentials.json ~/.claude/.credentials.json
  chmod 600 ~/.claude/.credentials.json
fi
if [ ! -f ~/.claude.json ]; then
  cat > ~/.claude.json <<'EOF'
{"hasCompletedOnboarding":true,"bypassPermissionsModeAccepted":true,"theme":"dark","projects":{"/home/node/work":{"hasTrustDialogAccepted":true,"projectOnboardingSeenCount":1}}}
EOF
fi

# --- X / VNC display (no VNC auth: the port is published on loopback only) ---
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true
Xvnc :1 -geometry 1280x800 -depth 24 -SecurityTypes None -AlwaysShared -localhost no \
  > /tmp/xvnc.log 2>&1 &
for i in $(seq 1 30); do [ -e /tmp/.X11-unix/X1 ] && break; sleep 0.3; done

# --- wallpaper FIRST so the screen shows a desktop (not black) while booting ---
WALLPAPER="$HOME/wallpapers/${NODE_NAME}.png"
[ -f "$WALLPAPER" ] || WALLPAPER="$HOME/wallpaper.png"
feh --bg-fill "$WALLPAPER" 2>/dev/null || hsetroot -solid "#0d3b40" 2>/dev/null || true
openbox &
sleep 1
feh --bg-fill "$WALLPAPER" 2>/dev/null || true
tint2 > /tmp/tint2.log 2>&1 &

# --- desktop storyline windows ------------------------------------------------
# Keep the OS visibly desktop-like: wallpaper + panel + multiple work surfaces.
# The main Claude terminal is large but deliberately not maximized, so the user
# can see that each Docker node is a real Linux workstation with local context.
# A dark backplate separates the work area from bright macOS-style wallpapers so
# the desktop still reads clearly in small noVNC tiles and demo recordings.
xmessage -geometry 1120x610+80+96 -bg "#05070acc" -fg "#05070c" -borderless " " >/tmp/backplate.log 2>&1 &
sleep 0.2
cat > /tmp/tao-mission.sh <<EOF
#!/usr/bin/env bash
export LANG=C.UTF-8 LC_ALL=C.UTF-8
while :; do
  clear
  echo "TRUE AGENTIC OS // ${NODE_NAME}"
  echo "────────────────────────────"
  case "${NODE_NAME}" in
    node-1)
      echo "Mission: Local knowledge base"
      echo
      echo "Available work:"
      echo "  • Search ./docs roadmap, notes, incidents"
      echo "  • Inspect dataset.csv"
      echo "  • Produce cited internal answers"
      ;;
    node-2)
      echo "Mission: Web research station"
      echo
      echo "Available work:"
      echo "  • Open a headed browser"
      echo "  • Gather public market/news sources"
      echo "  • Write sourced research briefs"
      ;;
    node-3)
      echo "Mission: Analytics workstation"
      echo
      echo "Available work:"
      echo "  • Analyze metrics.csv"
      echo "  • Run Python calculations"
      echo "  • Produce ranked regional reports"
      ;;
    *)
      echo "Mission: General Linux worker"
      echo
      echo "Available work:"
      echo "  • Terminal"
      echo "  • Local workspace"
      echo "  • Browser-capable automation"
      ;;
  esac
  echo
  echo "The orchestrator routes tasks here when this"
  echo "machine has the right local data or capability."
  sleep 20
done
EOF
chmod +x /tmp/tao-mission.sh

# The Claude terminal carries its own WM_CLASS (ClaudeTerm) so the orchestrator
# can find it with `xdotool search --class ClaudeTerm` regardless of window
# order or title (Claude Code rewrites the title while it runs).
xterm -class ClaudeTerm -u8 -fa "DejaVu Sans Mono" -fs 12 -bg "#05070C" -fg "#F3F6FA" -bd "#2DD4BF" -cr "#2DD4BF" -T "claude — ${NODE_NAME}" \
  -geometry 104x30+112+132 \
  -e bash -lc "export LANG=C.UTF-8 LC_ALL=C.UTF-8; cd ~/work; claude --dangerously-skip-permissions --model ${CLAUDE_MODEL}; exec bash" &

xterm -u8 -fa "DejaVu Sans Mono" -fs 10 -bg "#0E1724" -fg "#D6DEE8" -bd "#2DD4BF" -T "mission — ${NODE_NAME}" \
  -geometry 38x12-88+136 -e /tmp/tao-mission.sh &

xterm -u8 -fa "DejaVu Sans Mono" -fs 10 -bg "#101827" -fg "#D6DEE8" -bd "#2DD4BF" -T "workspace — ${NODE_NAME}" \
  -geometry 38x9-88-86 \
  -e bash -lc "cd ~/work; while :; do clear; echo '~/work'; echo '──────'; ls -lah; sleep 4; done" &

# --- noVNC web bridge (serves clean.html + proxies the screen). Up immediately
#     so the client shows "powering on…" until the X display is reachable, then
#     the wallpaper (already set) instead of a black screen. ---
exec websockify --web /usr/share/novnc 6080 localhost:5901
