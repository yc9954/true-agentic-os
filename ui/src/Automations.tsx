// Automations — a ComfyUI/n8n-style canvas where you ASSEMBLE how a task is
// distributed across the fleet, then run it. Each operation block names a step
// (web research / file search / analysis / training / custom) and the machine
// it runs on; wiring them up and hitting "Run on fleet" dispatches the assembled
// pipeline to the orchestrator (POST /api/pipeline/run) and synthesizes.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, Handle, Position,
  type Node, type Edge, type Connection, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Flag, Search, Globe, BarChart3, Boxes, Wand2, Workflow as WorkflowIcon, MessageSquareText,
  Play, Plus, Server, X, Layers, FileText, GitBranch, type LucideIcon,
} from "lucide-react";
import type { PipelineStep } from "./useFleet";

// ---- operation catalog (the building blocks) -------------------------------
interface OpMeta { title: string; icon: LucideIcon; desc: string; }
const OPS: Record<string, OpMeta> = {
  web:     { title: "Web Research",      icon: Globe,     desc: "WebSearch — live internet, returns headlines + source URLs" },
  file:    { title: "File Search",       icon: Search,    desc: "Search this machine's local ./docs and quote the lines" },
  analyze: { title: "Data Analysis",     icon: BarChart3, desc: "Crunch the machine's local CSV (totals / rankings)" },
  train:   { title: "Distributed Train", icon: Boxes,     desc: "Shard a dataset across the fleet and fit a model" },
  custom:  { title: "Custom Step",       icon: Wand2,     desc: "Run your own instruction on a chosen machine" },
};
const DEFAULT_MACHINE: Record<string, string> = { web: "node-2", file: "node-1", analyze: "node-3" };

// ---- editor context (so nodes can edit themselves / read the fleet) --------
interface EditorApi {
  machines: string[];
  update: (id: string, patch: Record<string, unknown>) => void;
  remove: (id: string) => void;
}
const Editor = createContext<EditorApi>({ machines: [], update: () => {}, remove: () => {} });

// ---- node visuals ----------------------------------------------------------
function Card({
  children, accent, className = "",
}: { children: React.ReactNode; accent?: boolean; className?: string }) {
  return (
    <div
      className={`w-[212px] rounded-xl border bg-panelhdr shadow-lg ${
        accent ? "border-accent/55" : "border-bd"
      } ${className}`}
    >
      {children}
    </div>
  );
}
function CardHead({ icon: Icon, title, accent }: { icon: LucideIcon; title: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2 border-b border-bd px-3 py-2">
      <Icon size={14} strokeWidth={2} className={accent ? "text-accent" : "text-fg2"} />
      <span className="text-[12.5px] font-semibold text-fg">{title}</span>
    </div>
  );
}
const inHandle = <Handle type="target" position={Position.Left} />;
const outHandle = <Handle type="source" position={Position.Right} />;

function GoalNode({ id, data }: NodeProps) {
  const { update } = useContext(Editor);
  const text = (data as any).text as string;
  return (
    <Card accent>
      <CardHead icon={Flag} title="Goal" accent />
      <div className="p-2.5">
        <textarea
          value={text}
          onChange={(e) => update(id, { text: e.target.value })}
          rows={3}
          className="nodrag w-full resize-none rounded-md border border-bd bg-panel px-2 py-1.5 text-[12px] leading-relaxed text-fg outline-none placeholder:text-fg3 focus:border-accent/60"
          placeholder="What should the fleet accomplish?"
        />
      </div>
      {outHandle}
    </Card>
  );
}

function StageNode({ data }: NodeProps) {
  const d = data as any;
  const Icon = d.icon as LucideIcon;
  return (
    <Card>
      <CardHead icon={Icon} title={d.title} />
      <div className="px-3 py-2 text-[11px] leading-relaxed text-fg3">{d.subtitle}</div>
      {d.hasIn !== false && inHandle}
      {d.hasOut !== false && outHandle}
    </Card>
  );
}

function OpNode({ id, data }: NodeProps) {
  const { machines, update, remove } = useContext(Editor);
  const d = data as any;
  const meta = OPS[d.op as string] ?? OPS.custom;
  const Icon = meta.icon;
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-bd px-3 py-2">
        <Icon size={14} strokeWidth={2} className="text-accent" />
        <span className="text-[12.5px] font-semibold text-fg">{meta.title}</span>
        <button
          onClick={() => remove(id)}
          data-testid="remove-step"
          className="nodrag ml-auto rounded p-0.5 text-fg3 hover:bg-bdsoft hover:text-err"
          title="remove step"
        >
          <X size={13} strokeWidth={2.5} />
        </button>
      </div>
      <div className="space-y-2 p-2.5">
        <div className="text-[11px] leading-snug text-fg3">{meta.desc}</div>
        <label className="flex items-center gap-1.5 rounded-md border border-bd bg-panel px-2 py-1">
          <Server size={12} strokeWidth={2} className="text-fg3" />
          <span className="text-[11px] text-fg3">runs on</span>
          <select
            value={d.machine}
            onChange={(e) => update(id, { machine: e.target.value })}
            className="nodrag ml-auto bg-transparent text-[11.5px] font-mono text-fg outline-none"
          >
            <option className="bg-panel" value="auto">auto</option>
            {machines.map((m) => (
              <option className="bg-panel" key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <input
          value={d.instruction ?? ""}
          onChange={(e) => update(id, { instruction: e.target.value })}
          placeholder="instruction (optional)"
          className="nodrag w-full rounded-md border border-bd bg-panel px-2 py-1 text-[11.5px] text-fg outline-none placeholder:text-fg3 focus:border-accent/60"
        />
      </div>
      {inHandle}
      {outHandle}
    </Card>
  );
}

const nodeTypes = { goal: GoalNode, stage: StageNode, op: OpNode };

// ---- initial pipeline ------------------------------------------------------
let _seq = 100;
const nid = () => `n${++_seq}`;

function initialGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: "goal", type: "goal", position: { x: 0, y: 150 },
      data: { text: "Brief me: our internal status from the team notes, our Q3 numbers, and what's new in the AI-agent market." } },
    { id: "inspect", type: "stage", position: { x: 250, y: 168 },
      data: { title: "Inspect Fleet", subtitle: "discover each machine's local data & role", icon: Layers } },
    { id: "web",     type: "op", position: { x: 500, y: 0 },   data: { op: "web", machine: DEFAULT_MACHINE.web } },
    { id: "file",    type: "op", position: { x: 500, y: 168 }, data: { op: "file", machine: DEFAULT_MACHINE.file } },
    { id: "analyze", type: "op", position: { x: 500, y: 336 }, data: { op: "analyze", machine: DEFAULT_MACHINE.analyze } },
    { id: "synth",   type: "stage", position: { x: 770, y: 150 },
      data: { title: "Synthesize", subtitle: "combine every machine's result into one answer", icon: WorkflowIcon } },
    { id: "answer",  type: "stage", position: { x: 1020, y: 168 },
      data: { title: "Answer", subtitle: "delivered to the chat", icon: MessageSquareText, hasOut: false } },
  ];
  const e = (s: string, t: string): Edge => ({ id: `${s}-${t}`, source: s, target: t, animated: true });
  const edges: Edge[] = [
    e("goal", "inspect"),
    e("inspect", "web"), e("inspect", "file"), e("inspect", "analyze"),
    e("web", "synth"), e("file", "synth"), e("analyze", "synth"),
    e("synth", "answer"),
  ];
  return { nodes, edges };
}

// ---- the canvas ------------------------------------------------------------
function Canvas({ machines, onRun }: { machines: string[]; onRun: (goal: string, steps: PipelineStep[]) => void }) {
  const init = useMemo(initialGraph, []);
  const [nodes, setNodes, onNodesChange] = useNodesState(init.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(init.edges);
  const [ran, setRan] = useState(false);

  const update = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [setNodes],
  );
  const remove = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    },
    [setNodes, setEdges],
  );
  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, animated: true }, es)),
    [setEdges],
  );

  const api = useMemo<EditorApi>(() => ({ machines, update, remove }), [machines, update, remove]);

  const addStep = (op: string) => {
    const id = nid();
    setNodes((ns) => {
      const ops = ns.filter((n) => n.type === "op").length;
      return ns.concat({
        id, type: "op",
        position: { x: 500, y: 470 + ops * 28 },
        data: { op, machine: DEFAULT_MACHINE[op] ?? "auto", instruction: "" },
      });
    });
    // auto-wire it into the pipeline (inspect -> step -> synth)
    setEdges((es) =>
      addEdge({ id: `synth-${id}`, source: id, target: "synth", animated: true },
        addEdge({ id: `inspect-${id}`, source: "inspect", target: id, animated: true }, es)),
    );
  };

  const run = () => {
    const goalNode = nodes.find((n) => n.type === "goal");
    const goal = ((goalNode?.data as any)?.text ?? "").toString().trim();
    if (!goal) return;
    const steps: PipelineStep[] = nodes
      .filter((n) => n.type === "op")
      .map((n) => {
        const d = n.data as any;
        return { op: d.op, nodeId: d.machine, instruction: (d.instruction ?? "").trim() || undefined, label: OPS[d.op]?.title };
      });
    onRun(goal, steps);
    setRan(true);
  };

  const opCount = nodes.filter((n) => n.type === "op").length;

  return (
    <Editor.Provider value={api}>
      <div className="flex h-full min-h-0 flex-col">
        {/* toolbar */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-bd bg-panelhdr px-3">
          <WorkflowIcon size={16} strokeWidth={2} className="text-accent" />
          <span className="text-[13px] font-semibold text-fg">Automations</span>
          <span className="text-[12px] text-fg3">· assemble how work is distributed</span>

          <div className="ml-4 flex items-center gap-1.5">
            <span className="mr-0.5 text-[11px] uppercase tracking-wider text-fg3">add step</span>
            {Object.entries(OPS).map(([op, meta]) => {
              const Icon = meta.icon;
              return (
                <button
                  key={op}
                  data-testid={`add-step-${op}`}
                  onClick={() => addStep(op)}
                  title={meta.desc}
                  className="flex items-center gap-1 rounded-md border border-bd bg-bdsoft px-2 py-1 text-[11.5px] text-fg2 hover:border-accent/50 hover:text-fg"
                >
                  <Icon size={12} strokeWidth={2} /> {meta.title}
                </button>
              );
            })}
          </div>

          <button
            data-testid="run-pipeline"
            onClick={run}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-onaccent hover:brightness-110"
          >
            <Play size={13} strokeWidth={2.5} fill="currentColor" /> Run on fleet
          </button>
        </div>

        {ran && (
          <div className="flex shrink-0 items-center gap-2 border-b border-bd bg-accentsoft px-3 py-1.5 text-[12px] text-accent">
            <Play size={12} strokeWidth={2.5} /> Pipeline dispatched — open the Fleet view to watch each machine run, then the synthesis.
          </div>
        )}

        <div className="flex shrink-0 items-center gap-3 border-b border-bd bg-panel px-3 py-2">
          <div className="flex items-center gap-2 rounded-md border border-bd bg-bdsoft px-2.5 py-1.5">
            <Flag size={13} strokeWidth={2} className="text-accent" />
            <span className="text-[11.5px] text-fg2">Goal</span>
          </div>
          <span className="font-mono text-[11px] text-fg3">→</span>
          <div className="flex items-center gap-2 rounded-md border border-bd bg-bdsoft px-2.5 py-1.5">
            <GitBranch size={13} strokeWidth={2} className="text-accent" />
            <span className="text-[11.5px] text-fg2">Split into node jobs</span>
          </div>
          <span className="font-mono text-[11px] text-fg3">→</span>
          <div className="flex items-center gap-2 rounded-md border border-bd bg-bdsoft px-2.5 py-1.5">
            <FileText size={13} strokeWidth={2} className="text-accent" />
            <span className="text-[11.5px] text-fg2">Write artifacts</span>
          </div>
          <span className="font-mono text-[11px] text-fg3">→</span>
          <div className="flex items-center gap-2 rounded-md border border-bd bg-bdsoft px-2.5 py-1.5">
            <WorkflowIcon size={13} strokeWidth={2} className="text-accent" />
            <span className="text-[11.5px] text-fg2">Orchestrator briefing</span>
          </div>
        </div>

        {/* canvas */}
        <div className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ animated: true }}
            minZoom={0.3}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#1c2128" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => (n.type === "op" ? "#2DD4BF" : "#2f3742")}
              maskColor="rgba(8,10,14,0.7)"
            />
          </ReactFlow>
          <div className="pointer-events-none absolute right-3 top-3 z-10 w-[285px] rounded-xl border border-bd bg-panelhdr/95 p-3 shadow-xl backdrop-blur-sm">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-fg">
              <WorkflowIcon size={14} strokeWidth={2} className="text-accent" />
              What this canvas does
            </div>
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-fg3">
              <div><span className="text-fg">Web Research</span> opens a visible browser on the web-capable machine.</div>
              <div><span className="text-fg">File Search</span> reads local documents that only that machine has.</div>
              <div><span className="text-fg">Data Analysis</span> runs local CSV/Python work and writes analysis.md.</div>
              <div><span className="text-fg">Distributed Train</span> shards a local dataset and merges partial model stats.</div>
              <div className="rounded-md border border-accent/25 bg-accent/10 px-2 py-1.5 text-accent">
                Every node produces an artifact; the orchestrator turns them into one final briefing.
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border border-bd bg-panelhdr/90 px-2.5 py-1.5 text-[11px] text-fg3">
            {opCount} operation{opCount !== 1 ? "s" : ""} · drag to arrange · drag handles to rewire
          </div>
        </div>
      </div>
    </Editor.Provider>
  );
}

export default function Automations({
  machines, onRun,
}: { machines: string[]; onRun: (goal: string, steps: PipelineStep[]) => void }) {
  return (
    <ReactFlowProvider>
      <Canvas machines={machines} onRun={onRun} />
    </ReactFlowProvider>
  );
}
