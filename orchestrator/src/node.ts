// Everything that touches a node (a Docker container running a Linux desktop
// with Claude Code on it): lifecycle, workspace I/O, dispatching a prompt into
// the on-screen terminal, and the host-side `claude` used for planning and
// synthesis.
import Docker from "dockerode";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_STREAM_MODEL, NODE_IMAGE, NODE_MODEL, VNC_BIND } from "./config.js";

const pExecFile = promisify(execFile);
let STREAM_MODEL = DEFAULT_STREAM_MODEL;

// The orchestrator's reasoning model (planner + synthesis) is changeable live
// through POST /api/settings.
export function setStreamModel(model: string): void {
  if (model && typeof model === "string" && /^[\w.:-]{3,80}$/.test(model)) STREAM_MODEL = model;
}
export function getStreamModel(): string {
  return STREAM_MODEL;
}

// Stream the HOST's authenticated `claude` token-by-token. onDelta receives the
// accumulated text so far (so the chat can render the orchestrator thinking live).
export function hostClaudeStream(prompt: string, onDelta: (text: string) => void): Promise<string> {
  return new Promise((resolve) => {
    let full = "";
    let buf = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(full.trim());
    };
    let cp;
    try {
      cp = spawn(
        "claude",
        ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", STREAM_MODEL],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      return finish();
    }
    cp.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let e: any;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.type === "stream_event" && e.event?.type === "content_block_delta" && e.event.delta?.type === "text_delta") {
          full += e.event.delta.text;
          onDelta(full);
        } else if (e.type === "assistant") {
          const txt = (e.message?.content ?? [])
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          if (txt && txt.length > full.length) {
            full = txt;
            onDelta(full);
          }
        } else if (e.type === "result" && typeof e.result === "string") {
          if (e.result.length >= full.length) full = e.result;
        }
      }
    });
    cp.on("close", finish);
    cp.on("error", finish);
  });
}

// Resolve the Docker socket. Works with Docker Desktop, Colima, OrbStack, etc.
function dockerClient(): Docker {
  const envSock =
    process.env.DOCKER_SOCKET ??
    (process.env.DOCKER_HOST?.startsWith("unix://")
      ? process.env.DOCKER_HOST.slice("unix://".length)
      : undefined);
  const candidates = [
    envSock,
    "/var/run/docker.sock",
    `${process.env.HOME}/.colima/default/docker.sock`,
    `${process.env.HOME}/.docker/run/docker.sock`,
    `${process.env.HOME}/.orbstack/run/docker.sock`,
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return new Docker({ socketPath: c });
    } catch {}
  }
  return new Docker();
}

const docker = dockerClient();

// Workspace-relative file names the orchestrator reads/writes on a node. Kept
// strict so they can never be interpreted by a shell.
const SAFE_NAME = /^[\w.-]{1,64}$/;
function assertSafeName(name: string): void {
  if (!SAFE_NAME.test(name) || name === "." || name === "..") throw new Error(`unsafe file name: ${name}`);
}

// ---- container lifecycle -----------------------------------------------------
export async function containerRunning(name: string): Promise<boolean> {
  try {
    const info = await docker.getContainer(name).inspect();
    return info.State?.Running === true;
  } catch {
    return false;
  }
}

// Power on a machine (idempotent) when the user connects it to the fleet.
export async function startContainer(name: string): Promise<void> {
  try {
    if (!(await containerRunning(name))) await docker.getContainer(name).start();
  } catch {}
}

// Does the machine exist (created), regardless of powered on/off?
export async function containerExists(name: string): Promise<boolean> {
  try {
    await docker.getContainer(name).inspect();
    return true;
  } catch {
    return false;
  }
}

// Containers provisioned by this tool (running or not), so machines added
// through the UI survive an orchestrator restart.
export interface KnownContainer {
  name: string;
  nodeName: string;
  hostPort: number | null;
}
export async function listFleetContainers(prefix: string): Promise<KnownContainer[]> {
  try {
    const list = await docker.listContainers({ all: true, filters: { name: [prefix] } });
    const out: KnownContainer[] = [];
    for (const c of list) {
      const name = (c.Names?.[0] ?? "").replace(/^\//, "");
      if (!name.startsWith(prefix)) continue;
      let nodeName = name.slice(prefix.length);
      let hostPort: number | null = null;
      try {
        const info = await docker.getContainer(name).inspect();
        const envName = (info.Config?.Env ?? []).find((e) => e.startsWith("NODE_NAME="));
        if (envName) nodeName = envName.slice("NODE_NAME=".length);
        const bindings = info.HostConfig?.PortBindings?.["6080/tcp"] ?? [];
        const p = Number(bindings[0]?.HostPort);
        if (p) hostPort = p;
      } catch {}
      out.push({ name, nodeName, hostPort });
    }
    return out;
  } catch {
    return [];
  }
}

// Provision a brand-new machine (created, powered off) for the fleet.
export async function provisionContainer(opts: {
  name: string;
  nodeName: string;
  hostPort: number;
  credsPath: string;
  network: string;
}): Promise<void> {
  await pExecFile(
    "docker",
    [
      "create",
      "--name", opts.name,
      "--hostname", opts.nodeName,
      "--network", opts.network,
      "-e", `NODE_NAME=${opts.nodeName}`,
      "-e", `CLAUDE_MODEL=${NODE_MODEL}`,
      "-p", `${VNC_BIND}:${opts.hostPort}:6080`,
      "--shm-size=256m",
      "-v", `${opts.credsPath}:/tmp/claude-credentials.json:ro`,
      "-v", `${opts.name}-work:/home/node/work`,
      NODE_IMAGE,
    ],
    { timeout: 30000 },
  );
}

// Is the machine's DESKTOP fully booted (its Claude terminal has appeared)?
// Used to delay the UI's live screen until there's something to show.
export async function desktopReady(container: string): Promise<boolean> {
  try {
    const out = await execCapture(container, ["bash", "-lc", `export DISPLAY=:1; ${FIND_CLAUDE_WINDOW}; echo "$wid"`]);
    return /\d/.test(out);
  } catch {
    return false;
  }
}

// ---- exec helpers ------------------------------------------------------------
// Run a command in a node and capture its full stdout (non-streaming). A hung
// exec would otherwise stall the registry poll loop forever, hence the timeout.
async function execCapture(container: string, cmd: string[], timeoutMs = 20000): Promise<string> {
  const c = docker.getContainer(container);
  const exec = await c.exec({
    Cmd: cmd,
    User: "node",
    Env: ["HOME=/home/node"],
    WorkingDir: "/home/node/work",
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const out = new PassThrough();
  const err = new PassThrough();
  docker.modem.demuxStream(stream, out, err);
  let buf = "";
  out.on("data", (d: Buffer) => (buf += d.toString("utf8")));
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try { (stream as any).destroy?.(); } catch {}
      resolve();
    }, timeoutMs);
    stream.on("end", () => { clearTimeout(t); resolve(); });
    stream.on("error", () => { clearTimeout(t); resolve(); });
  });
  return buf;
}

// Fire-and-forget exec (no output wanted).
async function execDetached(container: string, cmd: string[], extraEnv: string[] = []): Promise<void> {
  const c = docker.getContainer(container);
  const exec = await c.exec({
    Cmd: cmd,
    User: "node",
    Env: ["HOME=/home/node", "DISPLAY=:1", ...extraEnv],
    WorkingDir: "/home/node/work",
    AttachStdout: false,
    AttachStderr: false,
  });
  await exec.start({ hijack: false, stdin: false });
}

// ---- workspace I/O -----------------------------------------------------------
export async function listWorkspace(container: string): Promise<{ name: string; size: number }[]> {
  try {
    const out = await execCapture(container, [
      "find", ".", "-maxdepth", "1", "-type", "f", "-printf", "%f|%s\\n",
    ]);
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [name, size] = l.split("|");
        return { name, size: Number(size) || 0 };
      })
      .filter((f) => f.name && !f.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// Read the newest file in a node's workspace (name + truncated content) so the
// orchestrator can synthesize what the node actually produced.
export async function readNewestFile(
  container: string,
): Promise<{ name: string; content: string } | null> {
  try {
    const out = await execCapture(container, [
      "bash",
      "-lc",
      'f=$(ls -t . 2>/dev/null | head -1); if [ -n "$f" ] && [ -f "$f" ]; then echo "$f"; head -c 400 -- "$f"; fi',
    ]);
    const nl = out.indexOf("\n");
    if (nl < 0) return null;
    return { name: out.slice(0, nl).trim(), content: out.slice(nl + 1).trim() };
  } catch {
    return null;
  }
}

// Inventory a node's local data so the orchestrator can distribute work by what
// each machine actually holds (name + a short content sample per file).
export async function readInventory(container: string): Promise<{ name: string; sample: string }[]> {
  try {
    const out = await execCapture(container, [
      "bash",
      "-lc",
      'for e in $(ls -1 . 2>/dev/null | grep -v "^.seeded$" | head -10); do if [ -f "$e" ]; then echo "@@F@@ $e"; head -c 240 -- "$e"; echo; elif [ -d "$e" ]; then echo "@@F@@ $e/ (folder containing: $(ls -1 "$e" 2>/dev/null | head -8 | tr "\\n" " "))"; fi; done',
    ]);
    return out
      .split("@@F@@ ")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => {
        const nl = p.indexOf("\n");
        const name = (nl < 0 ? p : p.slice(0, nl)).trim();
        const sample = (nl < 0 ? "" : p.slice(nl + 1)).replace(/\s+/g, " ").trim().slice(0, 200);
        return { name, sample };
      });
  } catch {
    return [];
  }
}

// Read a file's text from a node's workspace (for collecting shard results).
export async function readTextFromNode(container: string, relPath: string): Promise<string> {
  assertSafeName(relPath);
  try {
    return await execCapture(container, ["bash", "-c", 'cat -- "$1" 2>/dev/null', "_", relPath]);
  } catch {
    return "";
  }
}

// Write a file into a node's workspace (for distributing data shards). The
// payload goes over stdin, so its size is not limited by argv.
export async function writeFileToNode(container: string, relPath: string, content: string): Promise<void> {
  assertSafeName(relPath);
  const c = docker.getContainer(container);
  const exec = await c.exec({
    Cmd: ["bash", "-c", 'cat > "$1"', "_", relPath],
    User: "node",
    Env: ["HOME=/home/node"],
    WorkingDir: "/home/node/work",
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: true });
  await new Promise<void>((resolve) => {
    stream.on("end", resolve);
    stream.on("error", () => resolve());
    stream.write(content, () => stream.end());
  });
}

// ---- desktop control ---------------------------------------------------------
// The Claude terminal is the xterm started with `-class ClaudeTerm` by the
// desktop entrypoint. Matching on WM_CLASS (not the title, which Claude Code
// rewrites, and not "the first XTerm", which may be the mission/workspace
// window) guarantees prompts land in the right window.
const FIND_CLAUDE_WINDOW =
  'wid=""; for i in $(seq 1 40); do wid=$(xdotool search --class ClaudeTerm 2>/dev/null | head -1); [ -n "$wid" ] && break; sleep 0.5; done';

// Dispatch a task by TYPING the prompt into the on-screen Claude Code terminal
// via xdotool, so the work is visible on the node's real screen. Newlines would
// be typed as Return (submitting a partial prompt), so the prompt is flattened.
export async function dispatchToDesktop(container: string, prompt: string): Promise<void> {
  const oneLine = prompt.replace(/\r?\n+/g, " ").replace(/\s{2,}/g, " ").trim();
  const safe = oneLine.replace(/'/g, `'\\''`);
  const script = [
    "export DISPLAY=:1",
    FIND_CLAUDE_WINDOW,
    '[ -n "$wid" ] || { echo "claude terminal not found" >&2; exit 1; }',
    'xdotool windowactivate --sync "$wid" 2>/dev/null || true',
    // clear the previous task so each dispatch starts on a clean screen
    // (type fully, let the slash palette settle, THEN Enter — avoids /cd mishit)
    'xdotool type --clearmodifiers --window "$wid" --delay 22 "/clear"',
    "sleep 0.8",
    'xdotool key --clearmodifiers --window "$wid" Return',
    "sleep 1.3",
    `xdotool type --clearmodifiers --window "$wid" --delay 14 -- '${safe}'`,
    "sleep 0.4",
    'xdotool key --clearmodifiers --window "$wid" Return',
  ].join("; ");
  const out = await execCapture(container, ["bash", "-lc", script], 120000);
  if (/claude terminal not found/.test(out)) throw new Error("claude terminal not found on desktop");
}

// Real, VISIBLE web browsing: launch the Playwright-driven headed Chromium on
// the node's desktop (streams over noVNC). Fire-and-forget — the process runs in
// the container and writes findings.md; the orchestrator's watchForOutput picks
// it up.
export async function browseOnNode(container: string, query: string): Promise<void> {
  await execDetached(
    container,
    [
      "bash", "-c",
      'cd /home/node/work; rm -f findings.md; OUT=/home/node/work/findings.md node /opt/browse/agent-browse.mjs "$1" > /tmp/browse.log 2>&1',
      "_", query,
    ],
    ["PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright"],
  );
}

// Interrupt whatever the node is doing: Escape in the Claude TUI and kill a
// running browse session.
export async function interruptDesktop(container: string): Promise<void> {
  try {
    await execDetached(container, [
      "bash", "-lc",
      'export DISPLAY=:1; pkill -f agent-browse.mjs 2>/dev/null; wid=$(xdotool search --class ClaudeTerm | head -1); [ -n "$wid" ] && { xdotool windowactivate --sync "$wid"; xdotool key --clearmodifiers --window "$wid" Escape; }; true',
    ]);
  } catch {}
}

// ---- completion watchers -----------------------------------------------------
export interface DoneWatcher {
  stop: () => void;
}

// A polling loop whose ticks never overlap (a slow docker exec must not let two
// ticks fire the completion callback twice).
function pollLoop(everyMs: number, tick: () => Promise<boolean>): DoneWatcher {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (stopped) return;
    let done = false;
    try {
      done = await tick();
    } catch {}
    if (stopped) return;
    if (done) {
      stopped = true;
      return;
    }
    timer = setTimeout(run, everyMs);
  };
  timer = setTimeout(run, everyMs);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

// Wait until a specific file appears (and looks like JSON) in a node — used for
// collecting computed results (stats.json). Calls onReady(true) on success and
// onReady(false) on timeout so the caller can flag a missing result.
export function watchForFile(
  container: string,
  relPath: string,
  onReady: (ok: boolean) => void,
  timeoutMs = 150000,
): DoneWatcher {
  const started = Date.now();
  return pollLoop(1500, async () => {
    const txt = await readTextFromNode(container, relPath);
    const ok = /[{[]/.test(txt) && /\d/.test(txt);
    if (ok) {
      onReady(true);
      return true;
    }
    if (Date.now() - started > timeoutMs) {
      onReady(false);
      return true;
    }
    return false;
  });
}

// Wait until ANY of the expected output files appears and is non-empty — the
// precise completion signal for a pipeline step (web→findings.md, file→answer.md,
// analyze→analysis.md). Falls back to onReady() on timeout so a step never hangs.
export function watchForOutput(
  container: string,
  names: string[],
  onReady: () => void,
  timeoutMs = 170000,
): DoneWatcher {
  const started = Date.now();
  return pollLoop(1500, async () => {
    for (const n of names) {
      const txt = await readTextFromNode(container, n);
      if (txt && txt.trim().length > 20) {
        onReady();
        return true;
      }
    }
    if (Date.now() - started > timeoutMs) {
      onReady();
      return true;
    }
    return false;
  });
}

// Completion heuristic for free-form tasks: the workspace produced output and
// then stopped changing. At least one change SINCE start is required before the
// quiet rule can fire — otherwise a task that doesn't touch the workspace for a
// while (a web search runs ~40s before writing its findings) is wrongly marked
// done early. A hard timeout is the only way to finish a task that never writes.
export function watchWorkspaceDone(container: string, onDone: () => void, timeoutMs = 150000): DoneWatcher {
  const started = Date.now();
  let last = "";
  let lastChange = Date.now();
  let init = false;
  let changed = false;
  return pollLoop(1500, async () => {
    const cur = JSON.stringify(await listWorkspace(container));
    if (!init) {
      last = cur;
      init = true;
    } else if (cur !== last) {
      last = cur;
      lastChange = Date.now();
      changed = true;
    }
    const elapsed = Date.now() - started;
    const quiet = Date.now() - lastChange;
    if ((changed && elapsed > 9000 && quiet > 5000) || elapsed > timeoutMs) {
      onDone();
      return true;
    }
    return false;
  });
}
