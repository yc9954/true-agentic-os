// Runtime configuration. Every value can be overridden with an environment
// variable (see .env.example at the repo root); the defaults reproduce the
// three-node demo fleet.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NodeDescriptor } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");

const env = (key: string, fallback: string): string => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : fallback;
};

// --- orchestrator ------------------------------------------------------------
export const PORT = Number(env("PORT", "4000"));
// Bind to loopback by default: the API has no authentication and every agent
// runs with --dangerously-skip-permissions. Set HOST=0.0.0.0 only on a network
// you trust.
export const HOST = env("HOST", "127.0.0.1");

// Language of the orchestrator's own narration and syntheses: "en" | "ko".
export type Lang = "en" | "ko";
export const DEFAULT_LANG: Lang = env("TAO_LANG", "en") === "ko" ? "ko" : "en";

// Model used by the host `claude` for planning + synthesis (changeable live
// through POST /api/settings) and the default model started inside each node.
export const DEFAULT_STREAM_MODEL = env("STREAM_MODEL", "claude-haiku-4-5-20251001");
export const NODE_MODEL = env("CLAUDE_MODEL", "claude-haiku-4-5-20251001");

// --- docker fleet -------------------------------------------------------------
export const NODE_IMAGE = env("TAO_IMAGE", "tao-desktop:latest");
export const NETWORK = env("TAO_NETWORK", "tao-net");
export const CONTAINER_PREFIX = env("TAO_CONTAINER_PREFIX", "tao-desk-");
// Host interface the per-node noVNC ports are published on. Loopback by
// default for the same reason as HOST above (the desktops have no VNC password).
export const VNC_BIND = env("TAO_VNC_BIND", "127.0.0.1");
export const VNC_BASE_PORT = Number(env("TAO_VNC_BASE_PORT", "6080"));
export const CREDS_PATH = path.resolve(
  REPO_ROOT,
  env("TAO_CREDS_PATH", "secrets/claude-credentials.json"),
);

export const HARNESS_ROOT = path.join(REPO_ROOT, ".tao", "harness");
export const UI_DIST = path.join(REPO_ROOT, "ui", "dist");

export const containerName = (nodeId: string): string => `${CONTAINER_PREFIX}${nodeId}`;

// The demo fleet. Capabilities are deliberately heterogeneous so that "Auto"
// routing has a meaningful decision to make (a GPU task -> node-1). The
// hardware values are DECLARED, not measured: in the Docker MVP every node
// shares the host. Each node is seeded with a distinct role and local data by
// node-desktop/desktop-entrypoint.sh (keyed on NODE_NAME).
function fleetNode(
  id: string,
  vncPort: number,
  hardware: NodeDescriptor["provides"]["hardware"],
): NodeDescriptor {
  return {
    id,
    name: id,
    container: containerName(id),
    endpoint: `docker://${containerName(id)}`,
    vncPort,
    connected: false,
    ready: false,
    status: "offline",
    provides: { tools: ["claude_code"], hardware, data: ["/home/node/work"], load: 0 },
    currentTaskId: null,
  };
}

export const FLEET: NodeDescriptor[] = [
  fleetNode("node-1", VNC_BASE_PORT + 1, { cpu: 4, ram_gb: 8, gpu: "RTX 4090 (24GB)" }),
  fleetNode("node-2", VNC_BASE_PORT + 2, { cpu: 2, ram_gb: 4, gpu: null }),
  fleetNode("node-3", VNC_BASE_PORT + 3, { cpu: 8, ram_gb: 32, gpu: null }),
];
