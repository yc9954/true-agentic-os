#!/usr/bin/env bash
# Bring up the DESKTOP node fleet (real Linux desktops over noVNC).
#   scripts/fleet-desktop.sh up | down | status | restart
# Each node exposes its noVNC web screen on a host port (node-1=6081, ...).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Every knob mirrors the orchestrator's .env (see .env.example).
CREDS="$ROOT/${TAO_CREDS_PATH:-secrets/claude-credentials.json}"
NET="${TAO_NETWORK:-tao-net}"
IMAGE="${TAO_IMAGE:-tao-desktop:latest}"
PREFIX="${TAO_CONTAINER_PREFIX:-tao-desk-}"
BIND="${TAO_VNC_BIND:-127.0.0.1}"          # noVNC has no password: keep it on loopback
BASE="${TAO_VNC_BASE_PORT:-6080}"
MODEL="${CLAUDE_MODEL:-claude-haiku-4-5-20251001}"
# node : host-novnc-port
NODES=("node-1:$((BASE+1))" "node-2:$((BASE+2))" "node-3:$((BASE+3))")
CMD="${1:-up}"

ensure_net() { docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null; }

up() {
  [ -f "$CREDS" ] || { echo "missing $CREDS — see README: Provide Claude credentials" >&2; exit 1; }
  docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "image $IMAGE not found — run: docker build -t $IMAGE ./node-desktop" >&2; exit 1; }
  ensure_net
  for entry in "${NODES[@]}"; do
    n="${entry%%:*}"; port="${entry##*:}"; cname="${PREFIX}$n"
    docker rm -f "$cname" >/dev/null 2>&1 || true
    # create the machine POWERED OFF — the user boots it from the Connect screen
    docker create --name "$cname" --hostname "$n" --network "$NET" \
      -e NODE_NAME="$n" -e CLAUDE_MODEL="$MODEL" \
      -p "${BIND}:${port}:6080" \
      --shm-size=256m \
      -v "$CREDS":/tmp/claude-credentials.json:ro \
      -v "${cname}-work":/home/node/work \
      "$IMAGE" >/dev/null
    echo "provisioned $cname (powered off · ${BIND}:${port})"
  done
}

down() {
  for entry in "${NODES[@]}"; do
    n="${entry%%:*}"
    docker rm -f "${PREFIX}$n" >/dev/null 2>&1 && echo "removed ${PREFIX}$n" || true
    docker volume rm "${PREFIX}${n}-work" >/dev/null 2>&1 || true  # fresh workspace (only seeded data)
  done
}

case "$CMD" in
  up) up ;;
  down) down ;;
  restart) down; up ;;
  status) docker ps -a --filter "name=${PREFIX}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" ;;
  *) echo "usage: fleet-desktop.sh [up|down|status|restart]" >&2; exit 1 ;;
esac
