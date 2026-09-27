# True Agentic OS — DESKTOP node image (builds on amd64 and arm64).
# A real, independent Linux desktop streamed over noVNC: Xvnc + openbox + tint2,
# with Claude Code running in a terminal on the desktop. The fleet UI embeds
# each node's live screen via an <iframe>.
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      tigervnc-standalone-server tigervnc-common \
      openbox tint2 hsetroot feh \
      xterm x11-utils dbus-x11 x11-xserver-utils xdotool wmctrl \
      novnc websockify \
      python3 \
      ca-certificates curl git procps \
      fonts-dejavu fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# Node.js + Claude Code
# NOTE: claude-code ships its runtime as a platform-native optional dependency
# (e.g. @anthropic-ai/claude-code-linux-arm64). Force --include=optional and run
# the postinstall in the foreground so the native binary is actually downloaded;
# otherwise `claude` errors with "native binary not installed" at runtime.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs \
 && npm install -g @anthropic-ai/claude-code@latest --include=optional --foreground-scripts \
 && claude --version \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/*

# Real web browsing: Playwright-driven Chromium (headed, shown on the desktop).
# Browsers live in a shared path the non-root node user can read.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN mkdir -p /opt/browse \
 && cd /opt/browse && npm init -y >/dev/null 2>&1 \
 && npm install playwright@1.49.1 \
 && npx playwright install --with-deps chromium \
 && npm cache clean --force \
 && chmod -R a+rX /opt/ms-playwright /opt/browse \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash node || true
COPY desktop-entrypoint.sh /usr/local/bin/desktop-entrypoint.sh
COPY agent-browse.mjs /opt/browse/agent-browse.mjs
COPY wallpaper.png /home/node/wallpaper.png
COPY wallpapers /home/node/wallpapers
COPY clean.html /usr/share/novnc/clean.html
RUN chmod +x /usr/local/bin/desktop-entrypoint.sh \
 && mkdir -p /home/node/work /home/node/.config/openbox \
 && chown -R node:node /home/node

USER node
ENV HOME=/home/node USER=node DISPLAY=:1 \
    LANG=C.UTF-8 LC_ALL=C.UTF-8 LANGUAGE=C.UTF-8
WORKDIR /home/node/work
EXPOSE 6080
ENTRYPOINT ["/usr/local/bin/desktop-entrypoint.sh"]
