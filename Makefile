# True Agentic OS — one-command workflows. See README.md for the narrative.
SHELL := /bin/bash
IMAGE ?= $(or $(TAO_IMAGE),tao-desktop:latest)

.PHONY: help setup image creds fleet-up fleet-down fleet-status ui orchestrator dev typecheck demo clean

help: ## list targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## install every workspace (orchestrator, ui, demo)
	npm --prefix orchestrator ci
	npm --prefix ui ci
	npm --prefix demo ci

image: ## build the node desktop image (Linux desktop + noVNC + Claude Code + Chromium)
	docker build -t $(IMAGE) ./node-desktop

creds: ## export the host's Claude Code OAuth credentials into secrets/ (macOS Keychain)
	@mkdir -p secrets
	@if [ -f "$$HOME/.claude/.credentials.json" ]; then \
	  cp "$$HOME/.claude/.credentials.json" secrets/claude-credentials.json; \
	else \
	  security find-generic-password -s "Claude Code-credentials" -w > secrets/claude-credentials.json; \
	fi
	@chmod 600 secrets/claude-credentials.json && echo "wrote secrets/claude-credentials.json"

fleet-up: ## provision the three desktop nodes (powered off until you click Connect)
	./scripts/fleet-desktop.sh up

fleet-down: ## remove the nodes and their work volumes
	./scripts/fleet-desktop.sh down

fleet-status: ## show node containers
	./scripts/fleet-desktop.sh status

ui: ## typecheck + build the SPA into ui/dist
	npm --prefix ui run build

orchestrator: ui ## run the orchestrator (serves ui/dist + API on http://127.0.0.1:4000)
	npm --prefix orchestrator start

dev: ## orchestrator with reload + Vite dev server (UI on :5173, API proxied to :4000)
	npm --prefix orchestrator run dev & npm --prefix ui run dev; wait

typecheck: ## tsc --noEmit for both packages
	npm --prefix orchestrator run typecheck
	npm --prefix ui run typecheck

demo: ## record the short demo with Playwright (needs a running orchestrator + fleet)
	cd demo && npx playwright install chromium && npm run record

clean: ## remove build output
	rm -rf ui/dist orchestrator/dist
