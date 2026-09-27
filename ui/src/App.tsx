import { useEffect, useRef, useState } from "react";
import {
  SquarePen, Server, Gpu, Cpu, ArrowUp, RadioTower, Workflow, Wifi,
  LoaderCircle, SquareTerminal, Settings2, Circle, Square, Route, ChevronDown,
  Zap, Check, Ellipsis, Split, Boxes, Plus, Power, Monitor, Maximize2, X,
  type LucideIcon,
} from "lucide-react";
import { useFleet, type ChatMessage, type PipelineStep } from "./useFleet";
import type { NodeDescriptor, NodeStatus, TaskStatus, DiscoveredMachine } from "./types";
import Automations from "./Automations";
import Customize from "./Customize";
import { applyTheme, storedTheme, storedTarget, storeTarget } from "./theme";

type View = "fleet" | "automations" | "customize";

// --- helpers ----------------------------------------------------------------
// Each node's live desktop is served by its own noVNC port on the same host.
function vncUrl(port: number): string {
  return `${location.protocol}//${location.hostname}:${port}/clean.html`;
}
function dotClass(status: NodeStatus): string {
  if (status === "idle") return "text-ok";
  if (status === "busy") return "text-warn animate-tao-pulse";
  return "text-fg3";
}
function taskBadge(s?: TaskStatus): { text: string; cls: string } | null {
  if (!s) return null;
  switch (s) {
    case "running": return { text: "running", cls: "text-warn bg-warn/15" };
    case "done": return { text: "done", cls: "text-ok bg-ok/15" };
    case "error": return { text: "error", cls: "text-err bg-err/15" };
    case "canceled": return { text: "canceled", cls: "text-fg3 bg-fg3/15" };
    default: return { text: s, cls: "text-fg3 bg-fg3/15" };
  }
}
// --- tmux-style fleet tiling (fully filled, main = active else node[0]) ------
interface PaneRect { gridColumn: string; gridRow: string }
interface TileLayout {
  container: { gridTemplateColumns: string; gridTemplateRows: string };
  panes: PaneRect[];
}
function tileLayout(n: number, active: number): TileLayout {
  if (n <= 0) n = 1;
  const main = active >= 0 && active < n ? active : 0;
  const mk = (container: TileLayout["container"], rects: PaneRect[], hasMain: boolean): TileLayout => {
    const panes = new Array<PaneRect>(rects.length);
    if (!hasMain) {
      for (let i = 0; i < rects.length; i++) panes[i] = rects[i];
      return { container, panes };
    }
    panes[main] = rects[0];
    let r = 1;
    for (let i = 0; i < rects.length; i++) if (i !== main) panes[i] = rects[r++];
    return { container, panes };
  };
  switch (n) {
    case 1:
      return { container: { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" }, panes: [{ gridColumn: "1", gridRow: "1" }] };
    case 2:
      return mk({ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr" },
        [{ gridColumn: "1", gridRow: "1" }, { gridColumn: "2", gridRow: "1" }], false);
    case 3: // main-horizontal: wide main on top, two below (terminals read better wide)
      return mk({ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1.25fr 1fr" },
        [{ gridColumn: "1 / 3", gridRow: "1" }, { gridColumn: "1", gridRow: "2" }, { gridColumn: "2", gridRow: "2" }], true);
    case 4:
      return mk({ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" },
        [{ gridColumn: "1", gridRow: "1" }, { gridColumn: "2", gridRow: "1" }, { gridColumn: "1", gridRow: "2" }, { gridColumn: "2", gridRow: "2" }], false);
    case 5:
      return mk({ gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr" },
        [{ gridColumn: "1 / 3", gridRow: "1" }, { gridColumn: "3", gridRow: "1" }, { gridColumn: "1", gridRow: "2" }, { gridColumn: "2", gridRow: "2" }, { gridColumn: "3", gridRow: "2" }], true);
    case 6:
      return mk({ gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr" },
        [{ gridColumn: "1", gridRow: "1" }, { gridColumn: "2", gridRow: "1" }, { gridColumn: "3", gridRow: "1" }, { gridColumn: "1", gridRow: "2" }, { gridColumn: "2", gridRow: "2" }, { gridColumn: "3", gridRow: "2" }], false);
    default: {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const panes: PaneRect[] = [];
      for (let i = 0; i < n; i++) panes.push({ gridColumn: `${(i % cols) + 1}`, gridRow: `${Math.floor(i / cols) + 1}` });
      return { container: { gridTemplateColumns: `repeat(${cols},1fr)`, gridTemplateRows: `repeat(${rows},1fr)` }, panes };
    }
  }
}

// --- a node = a real, independent computer screen (live noVNC desktop) -------
function NodeDesktop({
  node, taskStatus, onStop, onFocus,
}: {
  node: NodeDescriptor;
  taskStatus?: TaskStatus;
  onStop: () => void;
  onFocus: () => void;
}) {
  const running = taskStatus === "running";
  const badge = taskBadge(taskStatus);
  const url = vncUrl(node.vncPort);

  return (
    <div
      data-testid={`node-panel-${node.id}`}
      className={`relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel ${running ? "tao-ring-run" : ""}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-bd bg-panelhdr px-3 py-1.5 font-mono text-[11px]">
        <Circle size={8} fill="currentColor" className={`shrink-0 ${dotClass(node.status)}`} />
        <Server size={13} strokeWidth={1.75} className="shrink-0 text-fg2" />
        <span className="text-fg">{node.id}.fleet.local</span>
        <span className="ml-1 flex items-center gap-1 truncate text-fg3">
          <Cpu size={11} strokeWidth={1.75} /> {node.provides.hardware.cpu}c · {node.provides.hardware.ram_gb}GB
          {node.provides.hardware.gpu ? " · GPU" : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {badge && (
            <span data-testid={`node-badge-${node.id}`} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
              {badge.text}
            </span>
          )}
          {running && <LoaderCircle size={13} className="animate-spin text-warn" />}
          {running && (
            <button onClick={onStop} className="rounded p-0.5 text-fg3 hover:bg-bdsoft hover:text-fg">
              <Square size={10} fill="currentColor" />
            </button>
          )}
        </div>
      </div>
      <div className="tao-monitor-stage relative min-h-0 flex-1 overflow-hidden">
        {node.ready ? (
          <div className="tao-monitor-frame">
            <iframe title={`${node.id} desktop`} src={url} className="absolute inset-0 h-full w-full border-0" data-testid={`vnc-${node.id}`} />
            <button
              onClick={onFocus}
              className="absolute inset-0 z-10 cursor-zoom-in bg-transparent opacity-0 transition-opacity hover:opacity-100"
              aria-label={`Open ${node.id} remote desktop`}
            >
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/60 px-2 py-1 font-mono text-[10px] text-fg shadow-lg backdrop-blur-sm">
                <Maximize2 size={11} strokeWidth={2} /> open
              </span>
            </button>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center gap-2 font-mono text-[12px] text-fg3">
            <LoaderCircle size={13} className="animate-spin text-warn" /> powering on…
          </div>
        )}
      </div>
    </div>
  );
}

function CollaborationStrip({ nodes, busyCount }: { nodes: NodeDescriptor[]; busyCount: number }) {
  if (nodes.length === 0) return null;
  const active = busyCount > 0;
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-bd bg-panelhdr px-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-fg">
        <Workflow size={14} strokeWidth={2} className="text-accent" />
        Fleet collaboration
      </div>
      <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
        {nodes.map((node, idx) => {
          return (
            <div key={node.id} className="flex min-w-0 items-center gap-2">
              <div className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 ${
                active ? "border-accent/35 bg-accent/10" : "border-bd bg-bdsoft"
              }`}>
                <Server size={12} strokeWidth={2} className={active ? "text-accent" : "text-fg3"} />
                <span className="font-mono text-[11px] text-fg">{node.id}</span>
                <span className="truncate text-[11px] text-fg3">{node.status === "busy" ? "working" : "available"}</span>
              </div>
              {idx < nodes.length - 1 && <span className={`font-mono text-[11px] ${active ? "text-accent" : "text-fg3"}`}>→</span>}
            </div>
          );
        })}
      </div>
      <div className="ml-auto rounded-md border border-bd bg-bdsoft px-2 py-1 text-[11px] text-fg2">
        {active ? `${busyCount} autonomous workers running` : "ready for parallel dispatch"}
      </div>
    </div>
  );
}

// --- left sidebar -----------------------------------------------------------
function Sidebar({
  nodes, connected, view, onNav, onNewTask,
}: {
  nodes: NodeDescriptor[]; connected: boolean;
  view: View; onNav: (v: View) => void; onNewTask: () => void;
}) {
  return (
    <div className="flex w-52 shrink-0 flex-col border-r border-bd bg-sidebar">
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 px-1 text-sm font-medium text-fg2">
          <SquareTerminal size={15} strokeWidth={1.75} className="text-accent" /> True Agentic OS
        </div>
        <div className="mt-3 space-y-0.5">
          <SidebarItem icon={SquarePen} label="New Task" hint="⌘N" onClick={onNewTask} />
          <SidebarItem icon={Workflow} label="Automations" active={view === "automations"} onClick={() => onNav("automations")} />
          <SidebarItem icon={Settings2} label="Customize" active={view === "customize"} onClick={() => onNav("customize")} />
        </div>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-auto px-3">
        <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-fg3">Nodes</div>
        <div className="space-y-0.5">
          {nodes.map((n) => {
            const active = n.status === "busy";
            return (
              <div key={n.id} data-testid={`sidebar-node-${n.id}`} onClick={() => onNav("fleet")}
                className={`cursor-pointer rounded-md px-2 py-1.5 ${active ? "bg-accentsoft shadow-[inset_2px_0_0_rgb(var(--accent-rgb))]" : "hover:bg-bdsoft"}`}>
                <div className="flex items-center gap-2 text-sm">
                  <Circle size={8} fill="currentColor" className={`shrink-0 ${dotClass(n.status)}`} />
                  <Server size={14} strokeWidth={1.75} className="shrink-0 text-fg2" />
                  <span className="font-mono text-[13px] text-fg">{n.id}</span>
                  {n.provides.hardware.gpu && (
                    <span className="ml-auto flex items-center gap-1 rounded bg-bdsoft px-1.5 py-0.5 text-[10px] text-fg2">
                      <Gpu size={11} strokeWidth={1.75} /> {n.provides.hardware.gpu.split(" ")[0]}
                    </span>
                  )}
                </div>
                <div className="ml-[22px] mt-0.5 font-mono text-[10px] text-fg3">
                  {n.provides.hardware.cpu}c · {n.provides.hardware.ram_gb}GB · {n.status}
                </div>
              </div>
            );
          })}
          {nodes.length === 0 && <div className="px-2 py-1.5 text-xs text-fg3">discovering…</div>}
        </div>
      </div>

      <div className="border-t border-bd px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-xs text-fg2">
          <Wifi size={13} strokeWidth={1.75} className={connected ? "text-ok" : "text-fg3"} />
          {connected ? "Connected" : "Disconnected"}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bd text-[11px] text-fg2">OP</span>
          <span className="text-sm text-fg">Operator</span>
          <span className="ml-auto text-[11px] text-fg3">Local</span>
        </div>
      </div>
    </div>
  );
}
function SidebarItem({
  icon: Icon, label, hint, active, onClick,
}: { icon: LucideIcon; label: string; hint?: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
        active ? "bg-accentsoft text-fg shadow-[inset_2px_0_0_rgb(var(--accent-rgb))]" : "text-fg2 hover:bg-bdsoft"
      }`}
    >
      <Icon size={15} strokeWidth={1.75} className={active ? "text-accent" : "text-fg3"} />
      {label}
      {hint && <span className="ml-auto text-[11px] text-fg3">{hint}</span>}
    </button>
  );
}

// --- right agent chat (Cursor-style) ----------------------------------------
function Caret() {
  return <span className="ml-0.5 inline-block animate-tao-blink text-accent">▌</span>;
}
function Markdownish({ text, mono = false }: { text: string; mono?: boolean }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inline = (s: string) => {
    const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return parts.map((p, idx) => {
      if (p.startsWith("`") && p.endsWith("`")) {
        return <code key={idx} className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[0.92em] text-fg">{p.slice(1, -1)}</code>;
      }
      if (p.startsWith("**") && p.endsWith("**")) {
        return <strong key={idx} className="font-semibold text-fg">{p.slice(2, -2)}</strong>;
      }
      return p;
    });
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(
        <pre key={key++} className="my-2 overflow-auto rounded-lg border border-bd bg-[#0b0e14] p-3 font-mono text-[12px] leading-relaxed text-fg2">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const tableStart =
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]);
    if (tableStart) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i])) {
          rows.push(lines[i].replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        }
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={key++} className="my-2 overflow-auto rounded-lg border border-bd">
          <table className="w-full border-collapse text-[12px]">
            {head && (
              <thead className="bg-bdsoft text-fg">
                <tr>{head.map((c, idx) => <th key={idx} className="border-b border-bd px-2 py-1.5 text-left font-semibold">{inline(c)}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {body.map((r, ridx) => (
                <tr key={ridx} className="odd:bg-white/[0.015]">
                  {r.map((c, cidx) => <td key={cidx} className="border-t border-bd/70 px-2 py-1.5 text-fg2">{inline(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-1.5 space-y-1 pl-4 text-[13px] leading-relaxed text-fg2">
          {items.map((item, idx) => <li key={idx} className="list-disc marker:text-accent">{inline(item)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="my-1.5 space-y-1 pl-4 text-[13px] leading-relaxed text-fg2">
          {items.map((item, idx) => <li key={idx} className="list-decimal marker:text-accent">{inline(item)}</li>)}
        </ol>,
      );
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      const level = line.match(/^#+/)?.[0].length ?? 1;
      const body = line.replace(/^#{1,3}\s+/, "");
      blocks.push(
        <div key={key++} className={`${level === 1 ? "mt-2 text-[15px]" : "mt-1.5 text-[13.5px]"} font-semibold text-fg`}>
          {inline(body)}
        </div>,
      );
      i++;
      continue;
    }

    const para = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("```") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]))
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <p key={key++} className={`${mono ? "font-mono text-[12px] text-fg2" : "text-[13px] text-fg"} my-1.5 leading-relaxed`}>
        {inline(para.join(" "))}
      </p>,
    );
  }

  return <div className="space-y-1">{blocks}</div>;
}
function ChatMsg({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="self-end max-w-[88%] rounded-[14px] border border-bd bg-white/[0.05] px-3 py-2 text-[13px] leading-relaxed text-fg">
        {m.text}
      </div>
    );
  }
  if (m.role === "orchestrator") {
    const body = m.text.replace(/^↳\s*/, "").trim();
    return (
      <div className="w-full">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-fg3">
          <Route size={12} strokeWidth={2} className="text-accent" /> Orchestrator
        </div>
        <div>
          <Markdownish text={body} mono />
          {m.streaming && <Caret />}
        </div>
      </div>
    );
  }
  if (m.role === "assistant") {
    return (
      <div className="w-full">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-fg3">
          <Workflow size={12} strokeWidth={2} className="text-accent" /> Synthesis
        </div>
        <div>
          <Markdownish text={m.text} />
          {m.streaming && <Caret />}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-fg3">
      <Check size={13} strokeWidth={2} className="shrink-0 text-ok" /> {m.text}
    </div>
  );
}

function shortModel(id: string): string {
  const m = id.match(/^claude-([a-z]+)-(\d+)-(\d+)/);
  return m ? `${m[1]}-${m[2]}.${m[3]}` : id;
}

function Composer({
  nodes, target, setTarget, onSend, focusSignal,
}: {
  nodes: NodeDescriptor[];
  target: string;
  setTarget: (t: string) => void;
  onSend: (prompt: string, target: string) => void;
  focusSignal?: number;
}) {
  const [text, setText] = useState("");
  const [model, setModel] = useState("");
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((s) => typeof s?.model === "string" && setModel(s.model)).catch(() => {});
  }, []);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focusSignal) ref.current?.focus(); }, [focusSignal]);
  const grow = () => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 200) + "px";
  };
  const send = () => {
    const v = text.trim();
    if (!v) return;
    onSend(v, target);
    setText("");
    requestAnimationFrame(() => { if (ref.current) ref.current.style.height = "auto"; });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  const TargetIcon =
    target === "auto" ? Workflow
    : target === "broadcast" ? RadioTower
    : target === "distribute" ? Split
    : target === "train" ? Boxes
    : Server;

  return (
    <div className="rounded-[14px] border border-bd bg-white/[0.03] focus-within:border-accent/60 focus-within:ring-1 focus-within:ring-accent/25">
      <textarea
        ref={ref}
        data-testid="composer-input"
        value={text}
        onChange={(e) => { setText(e.target.value); grow(); }}
        onKeyDown={onKey}
        rows={1}
        placeholder="Message the fleet…  (↵ to send)"
        className="block max-h-[200px] min-h-[38px] w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg3"
      />
      <div className="flex items-center gap-1.5 px-2 pb-2 pt-0.5">
        <span className="inline-flex items-center gap-1 rounded-[6px] border border-bd bg-white/[0.03] py-0.5 pl-2 pr-1 text-[12px] text-fg2">
          <TargetIcon size={13} strokeWidth={1.75} className="text-accent" />
          <select
            data-testid="node-select"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="bg-transparent text-[12px] text-fg2 outline-none"
          >
            <option className="bg-panel" value="auto">Auto</option>
            <option className="bg-panel" value="distribute">Distribute · split by data</option>
            <option className="bg-panel" value="train">Train · shard a dataset</option>
            <option className="bg-panel" value="broadcast">All agents</option>
            {nodes.map((n) => (
              <option className="bg-panel" key={n.id} value={n.id}>{n.id}</option>
            ))}
          </select>
        </span>
        <span className="inline-flex items-center gap-1 rounded-[6px] border border-accent/40 bg-accent/10 py-0.5 pl-1.5 pr-1 text-[12px] font-medium text-accent">
          <Zap size={12} strokeWidth={2} /> Agent <ChevronDown size={11} className="opacity-70" />
        </span>
        <span className="hidden items-center gap-1 text-[12px] text-fg3 sm:inline-flex" title={model}>{model ? shortModel(model) : "…"}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="select-none font-mono text-[11px] text-fg3">↵</span>
          <button
            data-testid="send-btn"
            onClick={send}
            disabled={!text.trim()}
            className="grid h-7 w-7 place-items-center rounded-full bg-accent text-onaccent hover:brightness-110 disabled:bg-bd disabled:text-fg3"
          >
            <ArrowUp size={15} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentChat({
  nodes, messages, target, setTarget, onSend, anyRunning, focusSignal, title = "Orchestrator · main",
}: {
  nodes: NodeDescriptor[];
  messages: ChatMessage[];
  target: string;
  setTarget: (t: string) => void;
  onSend: (prompt: string, target: string) => void;
  anyRunning: boolean;
  focusSignal?: number;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [messages]);

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-bd bg-panelhdr">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-bd px-3">
        {anyRunning && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
        <span className="flex-1 truncate text-[13px] font-medium text-fg">{title}</span>
        <button className="grid h-7 w-7 place-items-center rounded-[6px] text-fg3 hover:bg-bdsoft hover:text-fg">
          <Ellipsis size={16} strokeWidth={2} />
        </button>
      </header>

      <div ref={ref} className="tao-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-3 py-4">
          {messages.length === 0 && (
            <div className="text-[13px] leading-relaxed text-fg3">
              Message the fleet below. The orchestrator routes your task to the right machine(s),
              and synthesizes the combined result here.
            </div>
          )}
          {messages.map((m) => <ChatMsg key={m.id} m={m} />)}
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3 pt-1">
        <Composer nodes={nodes} target={target} setTarget={setTarget} onSend={onSend} focusSignal={focusSignal} />
      </div>
    </aside>
  );
}

// --- onboarding: connect your fleet -----------------------------------------
function ConnectScreen() {
  const [machines, setMachines] = useState<DiscoveredMachine[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState(false);
  const [addr, setAddr] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/discovered")
        .then((r) => r.json())
        .then((m: DiscoveredMachine[]) => {
          if (stop) return;
          setMachines(m);
          // default-select every discoverable machine the first time
          setSel((prev) => (prev.size ? prev : new Set(m.filter((x) => x.available).map((x) => x.id))));
        })
        .catch(() => {});
    load();
    const iv = setInterval(load, 2000);
    return () => { stop = true; clearInterval(iv); };
  }, []);

  const toggle = (id: string) =>
    setSel((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const connect = async () => {
    setConnecting(true);
    await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...sel] }),
    }).catch(() => setConnecting(false));
    // the WS snapshot will populate the fleet and swap this screen out
  };

  const addMachine = async () => {
    setAdding(true);
    try {
      const r = await fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addr.trim() || undefined }),
      });
      const j = await r.json();
      if (j?.id) setSel((p) => new Set(p).add(j.id)); // pre-select the new one
      setAddr("");
    } catch {}
    setAdding(false);
  };

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-[580px] rounded-2xl border border-bd bg-panelhdr p-6 shadow-xl">
        <div className="flex items-center gap-2 text-[17px] font-semibold text-fg">
          <SquareTerminal size={18} strokeWidth={1.75} className="text-accent" /> Connect your fleet
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg3">
          Pick the machines to bring into your agentic OS. Connecting powers each one on; the
          orchestrator then discovers what it holds and runs agents across your fleet.
        </p>

        <div className="mt-4 space-y-2">
          {machines.length === 0 && <div className="text-[13px] text-fg3">discovering machines…</div>}
          {machines.map((m) => {
            const on = sel.has(m.id);
            return (
              <button
                key={m.id}
                data-testid={`discover-${m.id}`}
                onClick={() => m.available && toggle(m.id)}
                disabled={!m.available}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  on ? "border-accent bg-accentsoft" : "border-bd bg-bdsoft hover:border-fg3"
                } ${m.available ? "" : "opacity-50"}`}
              >
                <span
                  className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border ${
                    on ? "border-accent bg-accent text-onaccent" : "border-fg3"
                  }`}
                >
                  {on && <Check size={12} strokeWidth={3} />}
                </span>
                <Server size={16} strokeWidth={1.75} className="shrink-0 text-fg2" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13px] text-fg">{m.name || m.id}.fleet.local</div>
                  <div className="font-mono text-[11px] text-fg3">
                    {m.provides.hardware.cpu} cores · {m.provides.hardware.ram_gb}GB
                    {m.provides.hardware.gpu ? ` · ${m.provides.hardware.gpu}` : ""}
                  </div>
                </div>
                <span className="flex items-center gap-1.5 text-[11px]">
                  {m.powered ? (
                    <><Circle size={7} fill="currentColor" className="text-ok" /><span className="text-fg2">online</span></>
                  ) : (
                    <><Power size={11} strokeWidth={2} className="text-fg3" /><span className="text-fg3">powered off</span></>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* add a machine by address */}
        <div className="mt-3 flex items-center gap-2">
          <Plus size={15} strokeWidth={2} className="text-fg3" />
          <input
            data-testid="add-addr"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMachine()}
            placeholder="add a machine — address or name (e.g. 192.168.1.42)"
            className="flex-1 rounded-md border border-bd bg-bdsoft px-2.5 py-1.5 font-mono text-[12px] text-fg outline-none placeholder:text-fg3 focus:border-accent/50"
          />
          <button
            data-testid="add-btn"
            onClick={addMachine}
            disabled={adding}
            className="rounded-md border border-bd px-3 py-1.5 text-[12px] font-medium text-fg2 hover:border-accent/50 hover:text-fg disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>

        <button
          data-testid="connect-btn"
          onClick={connect}
          disabled={connecting || sel.size === 0}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-onaccent hover:brightness-110 disabled:opacity-40"
        >
          {connecting ? (
            <><LoaderCircle size={16} className="animate-spin" /> Powering on & connecting…</>
          ) : (
            <><Wifi size={16} strokeWidth={2} /> Connect {sel.size} machine{sel.size !== 1 ? "s" : ""}</>
          )}
        </button>
      </div>
    </div>
  );
}

// --- app --------------------------------------------------------------------
export default function App() {
  const { nodes, nodeTaskStatus, messages, connected, dispatch, cancelNode, runPipeline, clearMessages } = useFleet();
  const [target, setTarget] = useState(storedTarget());
  const [view, setView] = useState<View>("fleet");
  const [focusSignal, setFocusSignal] = useState(0);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  // apply the saved accent theme on boot
  useEffect(() => { applyTheme(storedTheme()); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusedNodeId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setDefaultTarget = (t: string) => { setTarget(t); storeTarget(t); };
  const onNewTask = () => {
    setView("fleet");
    clearMessages();
    setFocusSignal((s) => s + 1);
  };
  const runFromCanvas = (goal: string, steps: PipelineStep[]) => {
    runPipeline(goal, steps);
    setView("fleet");
  };

  const onlineCount = nodes.filter((n) => n.status !== "offline").length;
  const busy = nodes.filter((n) => n.status === "busy");
  const active = nodes.length === 1 ? 0 : -1;
  const tl = tileLayout(nodes.length, active);
  const focusedNode = focusedNodeId ? nodes.find((n) => n.id === focusedNodeId) : null;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-app font-sans text-fg">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-bd bg-app px-4">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-fg3">
          <Server size={13} strokeWidth={1.75} className={onlineCount ? "text-ok" : "text-fg3"} />
          {onlineCount}/{nodes.length} nodes online
        </div>
      </div>

      {nodes.length === 0 ? (
        <ConnectScreen />
      ) : (
        <div className="flex min-h-0 flex-1">
          <Sidebar nodes={nodes} connected={connected} view={view} onNav={setView} onNewTask={onNewTask} />

          {view === "automations" ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              <Automations machines={nodes.map((n) => n.id)} onRun={runFromCanvas} />
            </div>
          ) : view === "customize" ? (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <Customize machines={nodes} defaultTarget={target} setDefaultTarget={setDefaultTarget} />
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <CollaborationStrip nodes={nodes} busyCount={busy.length} />
                <div
                  className="grid h-[calc(100%-3rem)] w-full gap-px bg-bd transition-[grid-template-columns,grid-template-rows] duration-200"
                  style={{ gridTemplateColumns: tl.container.gridTemplateColumns, gridTemplateRows: tl.container.gridTemplateRows }}
                >
                  {nodes.map((n, i) => (
                    <div key={n.id} className="min-h-0 min-w-0 overflow-hidden" style={tl.panes[i]}>
                      <NodeDesktop
                        node={n}
                        taskStatus={nodeTaskStatus[n.id]}
                        onStop={() => cancelNode(n.id)}
                        onFocus={() => setFocusedNodeId(n.id)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <AgentChat
                nodes={nodes}
                messages={messages}
                target={target}
                setTarget={setDefaultTarget}
                onSend={dispatch}
                anyRunning={busy.length > 0}
                focusSignal={focusSignal}
              />
            </>
          )}
        </div>
      )}

      {focusedNode && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-md">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 bg-[#0b0e14]/95 px-4">
            <Circle size={8} fill="currentColor" className={dotClass(focusedNode.status)} />
            <Monitor size={15} strokeWidth={1.8} className="text-accent" />
            <span className="font-mono text-[13px] text-fg">{focusedNode.id}.fleet.local</span>
            <span className="text-[12px] text-fg3">
              remote desktop · press Esc to close
            </span>
            <button
              onClick={() => setFocusedNodeId(null)}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-bd bg-bdsoft px-2 py-1 text-[12px] text-fg2 hover:border-accent/50 hover:text-fg"
            >
              <X size={13} strokeWidth={2.5} /> Close
            </button>
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="tao-monitor-stage min-h-0 flex-1 p-5">
              <div className="tao-monitor-frame">
                <iframe
                  title={`${focusedNode.id} expanded desktop`}
                  src={vncUrl(focusedNode.vncPort)}
                  className="absolute inset-0 h-full w-full border-0"
                  data-testid={`vnc-focused-${focusedNode.id}`}
                />
              </div>
            </div>
            <AgentChat
              nodes={[focusedNode]}
              messages={messages}
              target={focusedNode.id}
              setTarget={() => {}}
              onSend={(prompt) => dispatch(prompt, focusedNode.id)}
              anyRunning={focusedNode.status === "busy"}
              title={`Direct · ${focusedNode.id}.fleet.local`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
