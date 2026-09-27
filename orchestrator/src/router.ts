// Deterministic router (the scheduler — NOT an LLM). Matches a task's
// requirements against node capabilities and picks placement.
import type { NodeDescriptor, TaskRequires } from "./types.js";

// Keyword heuristics only; `requires` can also be passed explicitly in the
// POST /api/tasks body. Korean terms are matched without \b (no word
// boundaries between Hangul syllables).
const GPU_EN = /\b(gpu|cuda|train|training|fine-?tune|inference|torch|tensorflow|tensor)\b/;
const GPU_KO = /(gpu|학습|훈련|파인튜닝|추론)/;

export function inferRequires(prompt: string): TaskRequires {
  const p = prompt.toLowerCase();
  const req: TaskRequires = { tools: ["claude_code"] };
  if (GPU_EN.test(p) || GPU_KO.test(p)) req.gpu = true;
  return req;
}

export interface RouteResult {
  nodeIds: string[];
  reason: string;
}

export function route(
  target: string,
  requires: TaskRequires,
  nodes: NodeDescriptor[],
): RouteResult {
  const online = nodes.filter((n) => n.status !== "offline");
  const idle = online.filter((n) => n.status === "idle");

  if (target === "broadcast") {
    return {
      nodeIds: idle.map((n) => n.id),
      reason: idle.length
        ? `broadcast → ${idle.length} idle node(s)`
        : "broadcast: no idle node",
    };
  }

  if (target !== "auto") {
    const n = nodes.find((x) => x.id === target);
    if (!n) return { nodeIds: [], reason: `node ${target} not found` };
    if (n.status === "offline") return { nodeIds: [], reason: `${target} is offline` };
    if (n.status === "busy") return { nodeIds: [], reason: `${target} is busy (stop its current task first)` };
    return { nodeIds: [target], reason: `manually targeted ${target}` };
  }

  // auto: filter by capability, idle only, least-loaded, deterministic by id.
  const candidates = idle
    .filter((n) => {
      if (requires.tools && !requires.tools.every((t) => n.provides.tools.includes(t))) {
        return false;
      }
      if (requires.gpu && !n.provides.hardware.gpu) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.provides.load !== b.provides.load) return a.provides.load - b.provides.load;
      return a.id.localeCompare(b.id);
    });

  if (candidates.length === 0) {
    return {
      nodeIds: [],
      reason: requires.gpu ? "no idle node has a GPU" : "no idle capable node",
    };
  }

  const chosen = candidates[0];
  const reason = requires.gpu
    ? `requires GPU → ${chosen.id} (${chosen.provides.hardware.gpu})`
    : `idle capable node → ${chosen.id}`;
  return { nodeIds: [chosen.id], reason };
}
