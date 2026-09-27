// Orchestrator HTTP + WebSocket server. Discovers nodes, routes tasks, types
// prompts into each node's on-screen Claude Code, and streams events to the UI.
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import fs from "node:fs/promises";

import {
  PORT, HOST, DEFAULT_LANG, CREDS_PATH, NETWORK, HARNESS_ROOT, UI_DIST, REPO_ROOT, type Lang,
} from "./config.js";
import { Registry } from "./registry.js";
import { route, inferRequires } from "./router.js";
import { strings } from "./i18n.js";
import {
  dispatchToDesktop, browseOnNode, interruptDesktop, watchWorkspaceDone, watchForFile, watchForOutput, listWorkspace,
  readNewestFile, hostClaudeStream, readInventory, readTextFromNode, writeFileToNode,
  containerRunning, startContainer, containerExists, provisionContainer,
  setStreamModel, getStreamModel,
  type DoneWatcher,
} from "./node.js";
import type { LogKind, NodeDescriptor, ServerEvent, Task, TaskRequires, TaskStatus } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const registry = new Registry();
const tasks = new Map<string, Task>();
const handles = new Map<string, Map<string, DoneWatcher>>(); // taskId -> nodeId -> watcher
let taskSeq = 0;
const MAX_TASK_HISTORY = 200;

// ---- AgentOS harness settings -------------------------------------------------
interface HarnessSettings {
  hooks: Record<string, boolean>;
  agents: Record<string, boolean>;
  skills: Record<string, boolean>;
  guardrails: Record<string, boolean>;
  defaultTarget: string;
}

const harnessSettings: HarnessSettings = {
  hooks: {
    on_start_inventory: true,
    before_handoff_artifact: true,
    after_done_workspace_index: true,
  },
  agents: {
    file_researcher: true,
    web_researcher: true,
    data_analyst: true,
    synthesizer: true,
  },
  skills: {
    cite_local_files: true,
    source_web_research: true,
    python_analysis: true,
    write_markdown_artifacts: true,
  },
  guardrails: {
    no_questions_during_runs: true,
    require_output_file: true,
    concise_handoff: true,
  },
  defaultTarget: "auto",
};
let lang: Lang = DEFAULT_LANG;
const t = () => strings(lang);

const VALID_TARGETS = new Set(["auto", "broadcast", "distribute", "train"]);

function mergeFlags(current: Record<string, boolean>, patch: unknown): Record<string, boolean> {
  if (!patch || typeof patch !== "object") return current;
  const next = { ...current };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (key in next && typeof value === "boolean") next[key] = value;
  }
  return next;
}

function updateHarnessSettings(body: any): HarnessSettings {
  harnessSettings.hooks = mergeFlags(harnessSettings.hooks, body?.hooks);
  harnessSettings.agents = mergeFlags(harnessSettings.agents, body?.agents);
  harnessSettings.skills = mergeFlags(harnessSettings.skills, body?.skills);
  harnessSettings.guardrails = mergeFlags(harnessSettings.guardrails, body?.guardrails);
  if (typeof body?.defaultTarget === "string" && VALID_TARGETS.has(body.defaultTarget)) {
    harnessSettings.defaultTarget = body.defaultTarget;
  }
  return harnessSettings;
}

const AGENT_ROLES: Record<string, string> = {
  file_researcher: "file_researcher — searches this machine's local docs and datasets and cites them",
  web_researcher: "web_researcher — gathers current public information online with sources",
  data_analyst: "data_analyst — computes figures from local CSVs with python3",
  synthesizer: "synthesizer — the orchestrator combines every machine's artifact into one answer",
};

// The harness preamble is typed into the node's terminal ahead of the user task.
// It is a single paragraph on purpose: newlines would submit it piecemeal.
function harnessPreamble(nodeId: string): string {
  const on = (group: "hooks" | "skills" | "guardrails" | "agents", key: string) => harnessSettings[group][key];
  const lines = [
    "Active AgentOS harness:",
    `- Node identity: ${nodeId}. Use this machine's local role and files before assuming another node has them.`,
  ];
  const agents = Object.keys(AGENT_ROLES).filter((k) => on("agents", k));
  if (agents.length) lines.push(`- Agent presets in this fleet: ${agents.map((k) => AGENT_ROLES[k]).join("; ")}. Act as the preset that matches this machine's ROLE.txt.`);
  if (on("hooks", "on_start_inventory")) lines.push("- Hook:on_start_inventory: first inspect ROLE.txt and the current workspace files relevant to the task.");
  if (on("hooks", "before_handoff_artifact")) lines.push("- Hook:before_handoff_artifact: write the result into the appropriate artifact file before saying done.");
  if (on("hooks", "after_done_workspace_index")) lines.push("- Hook:after_done_workspace_index: leave outputs in ~/work so the orchestrator can index and synthesize them.");
  if (on("skills", "cite_local_files")) lines.push("- Skill:cite_local_files: when using local files, cite filenames and quote the relevant lines.");
  if (on("skills", "source_web_research")) lines.push("- Skill:source_web_research: when doing web research, include source titles and URLs.");
  if (on("skills", "python_analysis")) lines.push("- Skill:python_analysis: use python3 for calculations or CSV analysis rather than mental arithmetic.");
  if (on("skills", "write_markdown_artifacts")) lines.push("- Skill:write_markdown_artifacts: prefer concise markdown artifacts such as findings.md, answer.md, analysis.md, or report.md.");
  if (on("guardrails", "no_questions_during_runs")) lines.push("- Guardrail:no_questions_during_runs: do not ask the user follow-up questions during a dispatched run; make reasonable assumptions and proceed.");
  if (on("guardrails", "require_output_file")) lines.push("- Guardrail:require_output_file: every successful run should leave at least one output file in the workspace.");
  if (on("guardrails", "concise_handoff")) lines.push("- Guardrail:concise_handoff: keep the final handoff short and point to the output file.");
  return `${lines.join(" ")} User task: `;
}

// ---- harness asset builder (.tao/harness) -------------------------------------
const harnessKinds = new Set(["hook", "skill", "agent"]);

function slugifyAssetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "asset";
}

// One line, no control characters — these values are written into scripts and
// front-matter, so they must never be able to open a new line or command.
function oneLine(s: string, max = 120): string {
  return s.replace(/[\r\n\t\0]+/g, " ").replace(/[`$\\]/g, "").trim().slice(0, max);
}

function assetDir(kind: string): string {
  const folder = kind === "hook" ? "hooks" : kind === "skill" ? "skills" : "agents";
  return path.join(HARNESS_ROOT, folder);
}

async function listHarnessAssets(): Promise<{ kind: string; name: string; path: string }[]> {
  const out: { kind: string; name: string; path: string }[] = [];
  for (const kind of harnessKinds) {
    const dir = assetDir(kind);
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith(".md") || n.endsWith(".sh"))) {
      out.push({ kind, name, path: path.relative(REPO_ROOT, path.join(dir, name)) });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function renderHarnessAsset(kind: string, rawName: string, rawTrigger: string, rawBody: string): { filename: string; content: string } {
  const name = oneLine(rawName);
  const trigger = oneLine(rawTrigger, 64) || "manual";
  const slug = slugifyAssetName(name);
  const body = rawBody.replace(/[\r\0]/g, "").trim().slice(0, 4000);
  if (kind === "hook") {
    // The body is delivered through a quoted heredoc: it is data, never code.
    return {
      filename: `${slug}.sh`,
      content: `#!/usr/bin/env bash
set -euo pipefail

# ${name}
# Trigger: ${trigger}
# Generated by True Agentic OS harness builder.

cat <<'TAO_HOOK_BODY'
[tao:${slug}] ${body || "run local preflight checks"}
TAO_HOOK_BODY
`,
    };
  }
  const title = kind === "skill" ? "Skill" : "Agent";
  return {
    filename: `${slug}.md`,
    content: `---
name: ${slug}
kind: ${kind}
trigger: ${JSON.stringify(trigger)}
---

# ${title}: ${name}

${body || "Describe the local operating procedure for this harness asset."}

## Operating Notes

- Keep outputs in the node workspace when used during a fleet run.
- Prefer concrete artifacts over chat-only handoffs.
`,
  };
}

// ---- WebSocket fan-out -------------------------------------------------------
const clients = new Set<WebSocket>();
function broadcast(ev: ServerEvent): void {
  const msg = JSON.stringify(ev);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}
const log = (taskId: string, nodeId: string, kind: LogKind, line: string) =>
  broadcast({ type: "task_log", taskId, nodeId, kind, line });

registry.on("node_status", (e: { nodeId: string; status: any; load: number; ready: boolean }) => {
  broadcast({ type: "node_status", nodeId: e.nodeId, status: e.status, load: e.load, ready: e.ready });
});

// ---- task bookkeeping --------------------------------------------------------
function newTask(prompt: string, target: string, requires: TaskRequires, assigned: string[], subtasks?: Record<string, string>): Task {
  const id = `t_${String(++taskSeq).padStart(3, "0")}`;
  const task: Task = {
    id, prompt, target, requires, assignedNodeIds: assigned,
    status: "running", startedAt: Date.now(), subtasks,
  };
  tasks.set(id, task);
  handles.set(id, new Map());
  if (tasks.size > MAX_TASK_HISTORY) {
    const oldest = tasks.keys().next().value as string | undefined;
    if (oldest) { tasks.delete(oldest); handles.delete(oldest); }
  }
  broadcast({ type: "task_created", task });
  return task;
}

function finishTask(task: Task, status: TaskStatus): void {
  task.status = status;
  task.endedAt = Date.now();
  broadcast({ type: "task_status", taskId: task.id, nodeId: "orchestrator", status });
}

function failTask(task: Task, reason: string): void {
  log(task.id, "orchestrator", "error", reason);
  finishTask(task, "error");
}

// Mark one node as finished with `task`; when every node is done, run `onAll`.
function nodeDone(task: Task, nodeId: string, remaining: Set<string>, onAll: () => Promise<void>): void {
  const node = registry.get(nodeId);
  registry.setIdle(nodeId, task.id);
  broadcast({ type: "task_status", taskId: task.id, nodeId, status: "done" });
  if (node) listWorkspace(node.container).then((files) => broadcast({ type: "node_files", nodeId, files })).catch(() => {});
  remaining.delete(nodeId);
  if (remaining.size === 0 && task.status === "running") {
    finishTask(task, "done");
    onAll().catch((err) => log(task.id, "orchestrator", "error", `synthesis failed: ${err?.message ?? err}`));
  }
}

// ---- Auto / manual / broadcast ------------------------------------------------
function dispatch(prompt: string, target: string, requires: TaskRequires): Task {
  const { nodeIds, reason } = route(target, requires, registry.list());
  const task = newTask(prompt, target, requires, nodeIds);
  log(task.id, "orchestrator", "system", `↳ routed: ${reason}`);
  if (!nodeIds.length) {
    finishTask(task, "error");
    return task;
  }
  const remaining = new Set(nodeIds);
  for (const nodeId of nodeIds) runOnNode(task, nodeId, prompt, remaining);
  return task;
}

// Start one node working on a (possibly node-specific) prompt; when every node
// in `remaining` is done, the orchestrator synthesizes the combined result.
function runOnNode(task: Task, nodeId: string, prompt: string, remaining: Set<string>): void {
  const node = registry.get(nodeId);
  if (!node) {
    remaining.delete(nodeId);
    return;
  }
  registry.setBusy(nodeId, task.id);
  broadcast({ type: "task_status", taskId: task.id, nodeId, status: "running" });

  const watcher = watchWorkspaceDone(node.container, () =>
    nodeDone(task, nodeId, remaining, () => synthesizeTask(task)),
  );
  handles.get(task.id)?.set(nodeId, watcher);

  dispatchToDesktop(node.container, harnessPreamble(nodeId) + prompt).catch((err) => {
    log(task.id, nodeId, "error", `dispatch failed: ${err?.message ?? err}`);
  });
}

// ---- Distribute: the orchestrator plans a sub-task per node -------------------
async function dispatchDistribute(goal: string): Promise<void> {
  const online = registry.list().filter((n) => n.status === "idle");
  const task = newTask(goal, "distribute", {}, online.map((n) => n.id), {});
  if (online.length === 0) return failTask(task, t().noOnlineNodes);

  log(task.id, "orchestrator", "system", `↳ inspecting ${online.length} nodes' local data & roles…`);
  const infos = await Promise.all(
    online.map(async (n) => ({
      id: n.id,
      gpu: n.provides.hardware.gpu,
      cpu: n.provides.hardware.cpu,
      ram: n.provides.hardware.ram_gb,
      files: await readInventory(n.container),
    })),
  );
  const desc = infos
    .map(
      (n) =>
        `${n.id} (cpu:${n.cpu}, ram:${n.ram}GB, gpu:${n.gpu ?? "none"}) — local: ${
          n.files.map((f) => `${f.name}="${f.sample}"`).join("; ") || "(none)"
        }`,
    )
    .join("\n");
  const plannerPrompt =
    `You are the orchestrator of a fleet of machines, each with its OWN local data/role. User goal: "${goal}".\n\n` +
    `Machines:\n${desc}\n\n` +
    `Decide who does what, using each machine's own data/role: a web-research node should look things up online (WebSearch); ` +
    `a node with local docs should search its files; an analytics node should crunch its metrics. ` +
    `Output EXACTLY one line per machine, in the form "<node-id>: <one concise sub-task>". No preamble, no other text.`;

  // Stream the orchestrator's planning live into the chat.
  const planText = await hostClaudeStream(plannerPrompt, (txt) =>
    broadcast({ type: "agent_stream", id: `${task.id}-plan`, role: "orchestrator", text: txt }),
  );

  const plan: Record<string, string> = {};
  for (const ln of planText.split("\n")) {
    const m = ln.match(/^\s*[-*]?\s*(node-\S+?)\s*[:\-–]\s*(.+)$/i);
    if (m && online.some((n) => n.id === m[1])) plan[m[1]] = m[2].trim();
  }
  for (const n of online) if (!plan[n.id]) plan[n.id] = goal; // fallback
  task.subtasks = plan;

  const remaining = new Set(online.map((n) => n.id));
  for (const n of online) runOnNode(task, n.id, plan[n.id], remaining);
}

// ---- Pipeline: the distribution is ASSEMBLED on the Automations canvas --------
// Each step names an operation (web / file / analyze / custom) and a target
// machine; the orchestrator dispatches each step's instruction to its machine,
// then synthesizes — the same 2-layer flow, but the wiring is what the user drew.
interface PipelineStep { op: string; nodeId?: string; instruction?: string; label?: string }

function opTemplate(op: string, goal: string): string {
  // Each worker prompt is SELF-CONTAINED and scoped to that machine's role, and
  // explicitly non-blocking: do the work now, write a file, stop. (Passing the
  // whole multi-part goal makes a node ask the user for data it doesn't have.)
  switch (op) {
    case "web":
      return `You are a web-research worker on one machine in a fleet. Do NOT ask the user any questions and do NOT defer the work — act now. Use the WebSearch tool to look up CURRENT, PUBLIC information online relevant to: "${goal}". Research only the parts that are publicly searchable online (market, news, competitors, trends); ignore anything that would need internal or private data you don't have. Then write a concise markdown brief to a file named findings.md in the current directory — each finding followed by its source title and URL. Write the file, then stop.`;
    case "file":
      return `You are a worker on a machine that holds local team documents under ./docs. Do NOT ask the user any questions — act now. Search the files under ./docs for anything relevant to: "${goal}". Quote the relevant lines and cite the file names. Write your answer to a file named answer.md in the current directory, then stop.`;
    case "analyze":
      return `You are a data-analysis worker on a machine that holds a local metrics CSV in the current directory. Do NOT ask the user any questions — act now. Read the CSV and compute the figures relevant to: "${goal}" (totals, rankings, growth — use python3 if helpful). Write your analysis to a file named analysis.md in the current directory, then stop.`;
    default:
      return goal;
  }
}
function opOutputFile(op: string): string | null {
  switch (op) {
    case "web": return "findings.md";
    case "file": return "answer.md";
    case "analyze": return "analysis.md";
    default: return null;
  }
}
// Prefer a machine whose seeded role matches the op; fall back to the first idle one.
const ROLE_BY_OP: Record<string, string> = { web: "node-2", file: "node-1", analyze: "node-3" };
function pickNodeForOp(op: string, online: NodeDescriptor[]): string | undefined {
  const want = ROLE_BY_OP[op];
  if (want && online.some((n) => n.id === want)) return want;
  return online[0]?.id;
}

async function dispatchPipeline(goal: string, steps: PipelineStep[]): Promise<void> {
  const online = registry.list().filter((n) => n.status === "idle");
  const task = newTask(goal, "pipeline", {}, [], {});
  if (online.length === 0) return failTask(task, t().noOnlineNodes);

  // resolve each canvas step to a concrete machine + instruction + output file
  const byNode = new Map<string, string[]>();
  const filesByNode = new Map<string, string[]>();
  const opsByNode = new Map<string, string[]>();
  for (const s of steps) {
    if (["goal", "plan", "inspect", "synthesize", "answer"].includes(s.op)) continue;
    const nodeId = s.nodeId && s.nodeId !== "auto" ? s.nodeId : pickNodeForOp(s.op, online);
    if (!nodeId || !online.some((n) => n.id === nodeId)) continue;
    const instr = (s.instruction && s.instruction.trim()) || opTemplate(s.op, goal);
    byNode.set(nodeId, [...(byNode.get(nodeId) ?? []), instr]);
    opsByNode.set(nodeId, [...(opsByNode.get(nodeId) ?? []), s.op]);
    const out = opOutputFile(s.op);
    if (out) filesByNode.set(nodeId, [...(filesByNode.get(nodeId) ?? []), out]);
  }
  if (byNode.size === 0) return failTask(task, t().noRunnableSteps);

  task.assignedNodeIds = [...byNode.keys()];
  for (const [nodeId, instrs] of byNode) task.subtasks![nodeId] = instrs.join("  Then: ");
  log(task.id, "orchestrator", "system", t().pipelineRun([...byNode.keys()]));

  // Each node finishes when its step's OUTPUT FILE appears (precise), not when
  // the workspace merely goes quiet (which misfires for long web searches).
  const remaining = new Set(byNode.keys());
  for (const [nodeId, instrs] of byNode) {
    const node = registry.get(nodeId);
    if (!node) { remaining.delete(nodeId); continue; }
    registry.setBusy(nodeId, task.id);
    broadcast({ type: "task_status", taskId: task.id, nodeId, status: "running" });
    const expected = filesByNode.get(nodeId) ?? [];
    const onDone = () => nodeDone(task, nodeId, remaining, () => synthesizeTask(task));
    const watcher = expected.length
      ? watchForOutput(node.container, expected, onDone)
      : watchWorkspaceDone(node.container, onDone);
    handles.get(task.id)?.set(nodeId, watcher);

    // A web-only node opens a REAL browser on its desktop (visible over noVNC)
    // and searches the live web; everything else types into the on-screen agent.
    const ops = opsByNode.get(nodeId) ?? [];
    if (ops.length === 1 && ops[0] === "web") {
      log(task.id, "orchestrator", "system", t().openingBrowser(nodeId));
      void (async () => {
        const query = await webQueryFor(goal);
        await browseOnNode(node.container, query);
      })().catch((err) => log(task.id, nodeId, "error", `browse failed: ${err?.message ?? err}`));
    } else {
      dispatchToDesktop(node.container, harnessPreamble(nodeId) + instrs.join("  Then: ")).catch((err) =>
        log(task.id, nodeId, "error", `dispatch failed: ${err?.message ?? err}`),
      );
    }
  }
}

// Turn a multi-part goal into a concise web-search query (the publicly-searchable
// part), so the browser searches something sensible — not the whole prompt.
async function webQueryFor(goal: string): Promise<string> {
  try {
    const q = await hostClaudeStream(
      `Give a concise 3-8 word web search query (only the query text, no quotes, no preamble) to research the publicly-searchable part of this goal: "${goal}"`,
      () => {},
    );
    const line = q.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "";
    if (line && line.length <= 120) return line.replace(/^["']|["']$/g, "");
  } catch {}
  return goal.slice(0, 80);
}

// ---- Train: shard a dataset across the fleet ----------------------------------
// A dataset lives on one node; the orchestrator detects it, shards it across
// the fleet, each node computes partial sufficient statistics in parallel, and
// the orchestrator aggregates them into one model (exact distributed
// least-squares linear regression).
async function dispatchTrain(goal: string): Promise<void> {
  const online = registry.list().filter((n) => n.status === "idle");
  const task = newTask(goal, "train", {}, online.map((n) => n.id), {});
  if (online.length === 0) return failTask(task, t().noOnlineNodes);

  // live "thinking" stream
  let plan = "";
  const think = async (line: string, pause = 600) => {
    plan += (plan ? "\n" : "") + line;
    broadcast({ type: "agent_stream", id: `${task.id}-plan`, role: "orchestrator", text: plan });
    await sleep(pause);
  };

  await think(t().trainLooking);
  let holder: NodeDescriptor | undefined;
  let csv = "";
  for (const n of online) {
    const txt = await readTextFromNode(n.container, "dataset.csv");
    if (txt && /\d/.test(txt)) { holder = n; csv = txt; break; }
  }
  if (!holder) {
    await think(t().trainNotFound);
    broadcast({ type: "agent_stream", id: `${task.id}-synth`, role: "assistant", text: t().trainNotFoundReply });
    return finishTask(task, "error");
  }

  const lines = csv.trim().split("\n");
  const hasHeader = /^[a-z_]+,[a-z_]+$/i.test(lines[0].trim());
  const header = hasHeader ? lines[0].trim() : "x,y";
  const rows = (hasHeader ? lines.slice(1) : lines).filter((l) => /\d/.test(l));
  await think(t().trainFound(holder.id, rows.length));

  // shard across all idle nodes and distribute
  const K = online.length;
  const shards: string[][] = Array.from({ length: K }, () => []);
  rows.forEach((r, i) => shards[i % K].push(r));
  await think(t().trainSharding(rows.length, K, online.map((n) => n.id)));
  await Promise.all(
    online.map((n, k) => writeFileToNode(n.container, "shard.csv", [header, ...shards[k]].join("\n") + "\n")),
  );
  // clear any stale stats.json so we wait for each node's FRESH result
  await Promise.all(online.map((n) => writeFileToNode(n.container, "stats.json", "").catch(() => {})));
  await think(t().trainRunning, 200);

  const perNode =
    "A file shard.csv (columns x,y) is in your working directory. Using python3, compute the linear-regression sufficient statistics over it: n (number of rows), sum_x, sum_y, sum_xy (sum of x*y), sum_xx (sum of x*x). Write ONLY a JSON object to stats.json with keys n,sum_x,sum_y,sum_xy,sum_xx, then reply DONE.";
  for (const n of online) task.subtasks![n.id] = t().trainSubtask;

  const remaining = new Set(online.map((n) => n.id));
  const missing = new Set<string>();
  for (const n of online) {
    registry.setBusy(n.id, task.id);
    broadcast({ type: "task_status", taskId: task.id, nodeId: n.id, status: "running" });
    // wait for the node to actually produce stats.json (not just "workspace quiet")
    const watcher = watchForFile(n.container, "stats.json", (ok) => {
      if (!ok) missing.add(n.id);
      nodeDone(task, n.id, remaining, () => aggregateTrain(task, online, rows.length, [...missing]));
    });
    handles.get(task.id)?.set(n.id, watcher);
    dispatchToDesktop(n.container, harnessPreamble(n.id) + perNode).catch((err) =>
      log(task.id, n.id, "error", `dispatch failed: ${err?.message ?? err}`),
    );
  }
}

// Aggregate each node's partial statistics into the exact least-squares fit.
async function aggregateTrain(task: Task, nodes: NodeDescriptor[], totalRows: number, missing: string[]): Promise<void> {
  let N = 0, Sx = 0, Sy = 0, Sxy = 0, Sxx = 0;
  const reported: string[] = [];
  for (const n of nodes) {
    const txt = await readTextFromNode(n.container, "stats.json").catch(() => "");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) continue;
    try {
      const s = JSON.parse(m[0]);
      N += Number(s.n) || 0;
      Sx += Number(s.sum_x) || 0;
      Sy += Number(s.sum_y) || 0;
      Sxy += Number(s.sum_xy) || 0;
      Sxx += Number(s.sum_xx) || 0;
      reported.push(`${n.id}: n=${s.n}`);
    } catch {}
  }
  const denom = N * Sxx - Sx * Sx;
  const slope = denom !== 0 ? (N * Sxy - Sx * Sy) / denom : 0;
  const intercept = N !== 0 ? (Sy - slope * Sx) / N : 0;

  const fallback = t().trainBriefing({
    totalRows, nodes: nodes.length, reported: reported.join("; "), missing, slope, intercept,
  });
  broadcast({ type: "agent_stream", id: `${task.id}-synth`, role: "assistant", text: fallback });
  if (N === 0) return; // nothing to narrate beyond the briefing
  const prompt = t().trainSynthPrompt({
    totalRows, nodes: nodes.length, reported: reported.join("; "), slope, intercept, N,
  });
  const final = await hostClaudeStream(prompt, (txt) => {
    if (txt.trim()) broadcast({ type: "agent_stream", id: `${task.id}-synth`, role: "assistant", text: txt });
  });
  if (!final.trim()) broadcast({ type: "agent_stream", id: `${task.id}-synth`, role: "assistant", text: fallback });
}

// ---- Synthesis ---------------------------------------------------------------
// The orchestrator gathers each node's output and produces a synthesized,
// fleet-level answer (via the host's authenticated `claude`).
async function synthesizeTask(task: Task): Promise<void> {
  const parts: string[] = [];
  for (const nodeId of task.assignedNodeIds) {
    const node = registry.get(nodeId);
    if (!node) continue;
    const files = await listWorkspace(node.container).catch(() => []);
    const newest = await readNewestFile(node.container).catch(() => null);
    let line = `${nodeId}`;
    if (task.subtasks?.[nodeId]) line += ` (assigned: ${task.subtasks[nodeId]})`;
    line += `: files [${files.map((f) => f.name).join(", ")}]`;
    if (newest) line += ` — ${newest.name}: "${newest.content.replace(/\s+/g, " ").slice(0, 700)}"`;
    parts.push(line);
  }
  const fallback = t().synthFallback(task.prompt, parts);
  broadcast({ type: "agent_stream", id: `${task.id}-synth`, role: "assistant", text: fallback });
  const distributed = !!task.subtasks && Object.keys(task.subtasks).length > 0;
  const final = await hostClaudeStream(t().synthPrompt(task.prompt, distributed, parts), (txt) => {
    if (txt.trim()) broadcast({ type: "agent_stream", id: `${task.id}-synth`, role: "assistant", text: txt });
  });
  if (!final.trim()) {
    broadcast({ type: "agent_stream", id: `${task.id}-synth`, role: "assistant", text: fallback });
  }
}

async function cancelTask(id: string): Promise<void> {
  const map = handles.get(id);
  const task = tasks.get(id);
  if (map) {
    for (const [nodeId, w] of map) {
      w.stop();
      const node = registry.get(nodeId);
      if (node) await interruptDesktop(node.container);
      registry.setIdle(nodeId, id);
      broadcast({ type: "task_status", taskId: id, nodeId, status: "canceled" });
    }
    map.clear();
  }
  if (task && task.status === "running") finishTask(task, "canceled");
}

// ---- HTTP API ----------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/api/nodes", (_req, res) => res.json(registry.list()));
app.get("/api/tasks", (_req, res) => res.json([...tasks.values()]));

// every discoverable machine: exists (available to add), powered on, connected
app.get("/api/discovered", async (_req, res) => {
  const out = await Promise.all(
    registry.all().map(async (n) => ({
      id: n.id,
      name: n.name,
      vncPort: n.vncPort,
      provides: n.provides,
      connected: n.connected,
      available: await containerExists(n.container),
      powered: await containerRunning(n.container),
    })),
  );
  res.json(out);
});

// add a brand-new machine to the fleet (provisions a powered-off container)
app.post("/api/machines", async (req, res) => {
  const label = oneLine(String(req.body?.name || req.body?.address || ""), 64);
  const node = registry.reserveSlot();
  try {
    await provisionContainer({
      name: node.container, nodeName: node.id, hostPort: node.vncPort, credsPath: CREDS_PATH, network: NETWORK,
    });
  } catch (err: any) {
    registry.remove(node.id);
    return res.status(500).json({ error: `provision failed: ${err?.message ?? err}` });
  }
  if (label) {
    node.name = label;
    node.endpoint = `tcp://${label}`;
  }
  res.json({ id: node.id, vncPort: node.vncPort });
});

// add the selected machines to the fleet (powers them on if needed)
app.post("/api/connect", async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === "string") : [];
  await Promise.all(ids.map((id) => startContainer(registry.get(id)?.container ?? "")));
  await registry.connect(ids);
  broadcast({ type: "snapshot", nodes: registry.list(), tasks: [...tasks.values()] });
  res.json({ connected: registry.list().map((n) => n.id) });
});

app.post("/api/tasks", (req, res) => {
  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== "string" || prompt.length > 20000) {
    return res.status(400).json({ error: "prompt required (string, ≤ 20000 chars)" });
  }
  const target: string = typeof req.body?.target === "string" && req.body.target ? req.body.target : harnessSettings.defaultTarget;
  if (!VALID_TARGETS.has(target) && !registry.get(target)) {
    return res.status(400).json({ error: `unknown target: ${target}` });
  }
  if (target === "distribute") {
    dispatchDistribute(prompt).catch((err) => console.error("[distribute]", err));
    return res.json({ status: "planning" });
  }
  if (target === "train") {
    dispatchTrain(prompt).catch((err) => console.error("[train]", err));
    return res.json({ status: "training" });
  }
  const r = req.body?.requires;
  const requires: TaskRequires =
    r && typeof r === "object"
      ? {
          tools: Array.isArray(r.tools) ? r.tools.filter((x: unknown) => typeof x === "string") : undefined,
          gpu: typeof r.gpu === "boolean" ? r.gpu : undefined,
          data: Array.isArray(r.data) ? r.data.filter((x: unknown) => typeof x === "string") : undefined,
        }
      : inferRequires(prompt);
  const task = dispatch(prompt, target, requires);
  res.json({ taskId: task.id, assignedNodeIds: task.assignedNodeIds, status: task.status });
});

app.post("/api/tasks/:id/cancel", async (req, res) => {
  await cancelTask(req.params.id);
  res.json({ ok: true });
});

// run a distribution PIPELINE assembled on the Automations canvas
app.post("/api/pipeline/run", (req, res) => {
  const goal: string = (req.body?.goal ?? "").toString().trim();
  const steps: PipelineStep[] = Array.isArray(req.body?.steps)
    ? req.body.steps.filter((s: any) => s && typeof s.op === "string")
    : [];
  if (!goal) return res.status(400).json({ error: "goal required" });
  if (steps.some((s) => s.op === "train")) {
    dispatchTrain(goal).catch((err) => console.error("[train]", err));
    return res.json({ status: "training" });
  }
  dispatchPipeline(goal, steps).catch((err) => console.error("[pipeline]", err));
  res.json({ status: "running" });
});

// orchestrator + AgentOS harness settings
const settingsView = () => ({ model: getStreamModel(), lang, harness: harnessSettings });
app.get("/api/settings", (_req, res) => res.json(settingsView()));
app.post("/api/settings", (req, res) => {
  if (typeof req.body?.model === "string") setStreamModel(req.body.model);
  if (req.body?.lang === "en" || req.body?.lang === "ko") lang = req.body.lang;
  updateHarnessSettings(req.body?.harness ?? req.body);
  res.json(settingsView());
});

app.get("/api/harness/assets", async (_req, res) => {
  res.json({ root: path.relative(REPO_ROOT, HARNESS_ROOT), assets: await listHarnessAssets() });
});

app.post("/api/harness/build", async (req, res) => {
  const kind = String(req.body?.kind ?? "");
  const name = String(req.body?.name ?? "").trim();
  const trigger = String(req.body?.trigger ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!harnessKinds.has(kind)) return res.status(400).json({ error: "kind must be hook, skill, or agent" });
  if (!name) return res.status(400).json({ error: "name required" });
  try {
    const rendered = renderHarnessAsset(kind, name, trigger, body);
    const dir = assetDir(kind);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, rendered.filename);
    await fs.writeFile(target, rendered.content, kind === "hook" ? { mode: 0o755 } : undefined);
    if (kind === "hook") await fs.chmod(target, 0o755).catch(() => {});
    res.json({ ok: true, path: path.relative(REPO_ROOT, target), assets: await listHarnessAssets() });
  } catch (err: any) {
    res.status(500).json({ error: `build failed: ${err?.message ?? err}` });
  }
});

app.all("/api/*", (_req, res) => res.status(404).json({ error: "not found" }));

// ---- Static UI ---------------------------------------------------------------
app.use(express.static(UI_DIST));
app.get("*", (_req, res) => {
  res.sendFile(path.join(UI_DIST, "index.html"), (err) => {
    if (err) res.status(503).type("text").send("UI not built yet — run `npm run build` in ui/ first.");
  });
});

// ---- Boot --------------------------------------------------------------------
const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/stream",
  // Reject cross-site WebSocket hijacking: a browser Origin must match the host
  // the page was served from (non-browser clients send no Origin).
  verifyClient: ({ origin, req }: { origin: string; req: import("node:http").IncomingMessage }) => {
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  },
});
wss.on("connection", (ws) => {
  clients.add(ws);
  const snapshot: ServerEvent = {
    type: "snapshot",
    nodes: registry.list(),
    tasks: [...tasks.values()],
  };
  ws.send(JSON.stringify(snapshot));
  ws.on("close", () => clients.delete(ws));
});

async function pollLoop(): Promise<void> {
  await registry.poll().catch(() => {});
  setTimeout(pollLoop, 3000);
}

process.on("unhandledRejection", (err) => console.error("[orchestrator] unhandled rejection:", err));

registry.discover().catch(() => {}).then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`[orchestrator] listening on http://${HOST}:${PORT} (lang=${lang}, model=${getStreamModel()})`);
    console.log(`[orchestrator] discoverable machines: ${registry.all().map((n) => n.id).join(", ")}`);
    pollLoop();
  });
});
