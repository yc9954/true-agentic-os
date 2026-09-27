// Customize — AgentOS harness settings. These are not cosmetic preferences:
// enabled hooks/skills/guardrails are persisted on the orchestrator and injected
// into every worker prompt before dispatch.
import { useEffect, useState } from "react";
import {
  BarChart3, Bot, Boxes, Check, Code2, Database, FileCheck2, FolderOpen, GitBranch, Globe,
  GraduationCap, Hammer, Languages, RadioTower, Route, Server, Settings2, ShieldCheck, Split, Workflow, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { NodeDescriptor } from "./types";

interface HarnessSettings {
  hooks: Record<string, boolean>;
  agents: Record<string, boolean>;
  skills: Record<string, boolean>;
  guardrails: Record<string, boolean>;
  defaultTarget: string;
}
interface HarnessAsset {
  kind: string;
  name: string;
  path: string;
}

const DEFAULT_HARNESS: HarnessSettings = {
  hooks: { on_start_inventory: true, before_handoff_artifact: true, after_done_workspace_index: true },
  agents: { file_researcher: true, web_researcher: true, data_analyst: true, synthesizer: true },
  skills: { cite_local_files: true, source_web_research: true, python_analysis: true, write_markdown_artifacts: true },
  guardrails: { no_questions_during_runs: true, require_output_file: true, concise_handoff: true },
  defaultTarget: "auto",
};

const HOOKS = [
  { id: "on_start_inventory", name: "Start inventory hook", desc: "Each worker first checks ROLE.txt and its workspace before acting." },
  { id: "before_handoff_artifact", name: "Artifact handoff hook", desc: "Workers must write an output file before saying the task is done." },
  { id: "after_done_workspace_index", name: "Workspace index hook", desc: "Keep outputs in ~/work so the orchestrator can index and synthesize them." },
];

const AGENTS = [
  { id: "file_researcher", name: "File researcher", desc: "Uses local docs and datasets; ideal for node-1." },
  { id: "web_researcher", name: "Web researcher", desc: "Collects sourced public information; ideal for node-2." },
  { id: "data_analyst", name: "Data analyst", desc: "Runs calculations and CSV analysis; ideal for node-3." },
  { id: "synthesizer", name: "Fleet synthesizer", desc: "Combines machine outputs into one final answer." },
];

const SKILLS = [
  { id: "cite_local_files", name: "Cite local files", desc: "Quote filenames and relevant lines when using local data." },
  { id: "source_web_research", name: "Source web research", desc: "Include source titles and URLs for web findings." },
  { id: "python_analysis", name: "Python analysis", desc: "Use python3 for CSV/math instead of ad hoc arithmetic." },
  { id: "write_markdown_artifacts", name: "Markdown artifacts", desc: "Prefer findings.md, answer.md, analysis.md, or report.md." },
];

const GUARDRAILS = [
  { id: "no_questions_during_runs", name: "No mid-run questions", desc: "Workers proceed with reasonable assumptions during dispatched runs." },
  { id: "require_output_file", name: "Require output file", desc: "A successful worker run should leave at least one artifact." },
  { id: "concise_handoff", name: "Concise handoff", desc: "Final worker handoffs stay short and point to the artifact." },
];

const BUILD_KINDS = [
  { id: "hook", icon: Wrench, name: "Hook", desc: "Shell script for lifecycle automation" },
  { id: "skill", icon: GraduationCap, name: "Skill", desc: "Reusable local operating procedure" },
  { id: "agent", icon: Bot, name: "Agent", desc: "Role preset for a worker persona" },
];

const MODES: { id: string; name: string; icon: LucideIcon; desc: string }[] = [
  { id: "auto",       name: "Auto",       icon: Workflow,   desc: "route to the single best machine" },
  { id: "distribute", name: "Distribute", icon: Split,      desc: "split by local data, then synthesize" },
  { id: "train",      name: "Train",      icon: Boxes,      desc: "shard a dataset across the fleet" },
  { id: "broadcast",  name: "All agents", icon: RadioTower, desc: "send the same task to every machine" },
];

function roleOf(id: string): { icon: LucideIcon; label: string } {
  if (id === "node-1") return { icon: Database, label: "Local knowledge base · ./docs + dataset.csv" };
  if (id === "node-2") return { icon: Globe, label: "Web research · live internet" };
  if (id === "node-3") return { icon: BarChart3, label: "Analytics · metrics.csv" };
  return { icon: Server, label: "General compute" };
}

function Section({ icon: Icon, title, desc, children }: {
  icon: LucideIcon; title: string; desc: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-bd bg-panelhdr p-4">
      <div className="flex items-center gap-2">
        <Icon size={15} strokeWidth={2} className="text-accent" />
        <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
      </div>
      <p className="mt-0.5 text-[12px] leading-relaxed text-fg3">{desc}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ToggleRow({
  item, checked, onToggle,
}: {
  item: { id: string; name: string; desc: string };
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left ${
        checked ? "border-accent bg-accentsoft" : "border-bd bg-bdsoft hover:border-fg3"
      }`}
    >
      <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border ${
        checked ? "border-accent bg-accent text-onaccent" : "border-fg3"
      }`}>
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-fg">{item.name}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-fg3">{item.desc}</span>
      </span>
    </button>
  );
}

export default function Customize({
  machines, defaultTarget, setDefaultTarget,
}: {
  machines: NodeDescriptor[];
  defaultTarget: string;
  setDefaultTarget: (t: string) => void;
}) {
  const [harness, setHarness] = useState<HarnessSettings>(DEFAULT_HARNESS);
  const [lang, setLang] = useState<"en" | "ko">("en");
  const [saved, setSaved] = useState(false);
  const [assets, setAssets] = useState<HarnessAsset[]>([]);
  const [buildKind, setBuildKind] = useState("hook");
  const [buildName, setBuildName] = useState("Workspace preflight");
  const [buildTrigger, setBuildTrigger] = useState("before_worker_dispatch");
  const [buildBody, setBuildBody] = useState("Inspect ROLE.txt, list workspace files, and fail fast if the required local artifact is missing.");
  const [builtPath, setBuiltPath] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s?.lang === "en" || s?.lang === "ko") setLang(s.lang);
        if (!s?.harness) return;
        setHarness({ ...DEFAULT_HARNESS, ...s.harness });
        if (typeof s.harness.defaultTarget === "string") setDefaultTarget(s.harness.defaultTarget);
      })
      .catch(() => {});
    fetch("/api/harness/assets")
      .then((r) => r.json())
      .then((s) => Array.isArray(s?.assets) && setAssets(s.assets))
      .catch(() => {});
  }, [setDefaultTarget]);

  const save = (next: HarnessSettings) => {
    setHarness(next);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ harness: next }),
    })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })
      .catch(() => {});
  };

  const pickLang = (next: "en" | "ko") => {
    setLang(next);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang: next }),
    })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })
      .catch(() => {});
  };

  const toggle = (group: "hooks" | "agents" | "skills" | "guardrails", id: string) => {
    save({ ...harness, [group]: { ...harness[group], [id]: !harness[group][id] } });
  };

  const pickMode = (id: string) => {
    setDefaultTarget(id);
    save({ ...harness, defaultTarget: id });
  };

  const buildAsset = () => {
    fetch("/api/harness/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: buildKind, name: buildName, trigger: buildTrigger, body: buildBody }),
    })
      .then((r) => r.json())
      .then((s) => {
        if (s?.path) setBuiltPath(s.path);
        if (Array.isArray(s?.assets)) setAssets(s.assets);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      })
      .catch(() => {});
  };

  const activeCount =
    Object.values(harness.hooks).filter(Boolean).length +
    Object.values(harness.agents).filter(Boolean).length +
    Object.values(harness.skills).filter(Boolean).length +
    Object.values(harness.guardrails).filter(Boolean).length;

  return (
    <div className="tao-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-6 py-6">
        <div className="mb-5 flex items-center gap-2">
          <Settings2 size={18} strokeWidth={2} className="text-accent" />
          <h2 className="text-[17px] font-semibold text-fg">AgentOS harness</h2>
          <span className="ml-1 rounded bg-bdsoft px-1.5 py-0.5 font-mono text-[11px] text-fg3">
            {activeCount} active
          </span>
          {saved && <span className="ml-2 flex items-center gap-1 text-[12px] text-ok"><Check size={13} /> saved</span>}
        </div>

        <div className="space-y-4">
          <Section icon={Hammer} title="Local harness builder" desc="Build real local hooks, skills, and agent presets into .tao/harness without leaving the AgentOS.">
            <div className="overflow-hidden rounded-lg border border-bd bg-[#0b0e14]">
              <div className="flex items-center gap-2 border-b border-bd bg-panel px-3 py-2">
                <Code2 size={14} strokeWidth={2} className="text-accent" />
                <span className="text-[12.5px] font-semibold text-fg">harness.workspace</span>
                <span className="ml-auto rounded border border-bd bg-bdsoft px-1.5 py-0.5 font-mono text-[10px] text-fg3">
                  .tao/harness
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[190px_1fr]">
                <div className="border-b border-bd bg-sidebar p-2 md:border-b-0 md:border-r">
                  {BUILD_KINDS.map((kind) => {
                    const Icon = kind.icon;
                    const on = buildKind === kind.id;
                    return (
                      <button
                        key={kind.id}
                        onClick={() => setBuildKind(kind.id)}
                        className={`mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left ${
                          on ? "bg-accentsoft text-fg shadow-[inset_2px_0_0_rgb(var(--accent-rgb))]" : "text-fg2 hover:bg-bdsoft"
                        }`}
                      >
                        <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border ${
                          on ? "border-accent/40 bg-accent/10 text-accent" : "border-bd bg-panel text-fg3"
                        }`}>
                          <Icon size={13} strokeWidth={2} />
                        </span>
                        <span>
                          <span className="block text-[12.5px] font-medium">{kind.name}</span>
                          <span className="block text-[10.5px] leading-snug text-fg3">{kind.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] uppercase tracking-wider text-fg3">Name</span>
                      <input
                        value={buildName}
                        onChange={(e) => setBuildName(e.target.value)}
                        className="w-full rounded-md border border-bd bg-panel px-2.5 py-1.5 text-[12px] text-fg outline-none placeholder:text-fg3 focus:border-accent/60"
                        placeholder="e.g. Workspace preflight"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] uppercase tracking-wider text-fg3">Trigger</span>
                      <input
                        value={buildTrigger}
                        onChange={(e) => setBuildTrigger(e.target.value)}
                        className="w-full rounded-md border border-bd bg-panel px-2.5 py-1.5 font-mono text-[12px] text-fg outline-none placeholder:text-fg3 focus:border-accent/60"
                        placeholder="before_worker_dispatch"
                      />
                    </label>
                  </div>

                  <label className="mt-2 block">
                    <span className="mb-1 block text-[11px] uppercase tracking-wider text-fg3">Local procedure</span>
                    <textarea
                      value={buildBody}
                      onChange={(e) => setBuildBody(e.target.value)}
                      rows={4}
                      className="w-full resize-none rounded-md border border-bd bg-panel px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-fg outline-none placeholder:text-fg3 focus:border-accent/60"
                      placeholder="Describe what this hook, skill, or agent should do locally..."
                    />
                  </label>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={buildAsset}
                      disabled={!buildName.trim()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-onaccent hover:brightness-110 disabled:opacity-40"
                    >
                      <Hammer size={13} strokeWidth={2.5} /> Build local asset
                    </button>
                    {builtPath && (
                      <span className="rounded-md border border-ok/20 bg-ok/10 px-2 py-1 font-mono text-[11px] text-ok">
                        wrote {builtPath}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 rounded-md border border-bd bg-panelhdr">
                    <div className="flex items-center gap-1.5 border-b border-bd px-2.5 py-1.5 text-[11px] font-medium text-fg2">
                      <FolderOpen size={12} strokeWidth={2} className="text-accent" /> local assets
                    </div>
                    <div className="max-h-[116px] overflow-auto p-2">
                      {assets.length === 0 ? (
                        <div className="px-1 py-1 text-[11px] text-fg3">No local harness assets yet.</div>
                      ) : (
                        <div className="space-y-1">
                          {assets.map((asset) => (
                            <div key={asset.path} className="flex items-center gap-2 rounded bg-bdsoft px-2 py-1 font-mono text-[11px] text-fg2">
                              <span className="w-10 text-fg3">{asset.kind}</span>
                              <span className="truncate">{asset.path}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Section>

          <Section icon={GitBranch} title="Routing profile" desc="The default dispatch behavior for new work. This belongs here because it changes how the AgentOS uses the fleet.">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {MODES.map((m) => {
                const on = (harness.defaultTarget || defaultTarget) === m.id;
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    data-testid={`mode-${m.id}`}
                    onClick={() => pickMode(m.id)}
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left ${
                      on ? "border-accent bg-accentsoft" : "border-bd bg-bdsoft hover:border-fg3"
                    }`}
                  >
                    <Icon size={15} strokeWidth={2} className={on ? "text-accent" : "text-fg2"} />
                    <div>
                      <div className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                        {m.name}{on && <Check size={13} className="text-accent" />}
                      </div>
                      <div className="mt-0.5 text-[11px] leading-snug text-fg3">{m.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section icon={Languages} title="Briefing language" desc="The language the orchestrator narrates its plan in and asks the model to write syntheses in. Worker prompts stay in English.">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([["en", "English"], ["ko", "한국어"]] as const).map(([id, name]) => {
                const on = lang === id;
                return (
                  <button
                    key={id}
                    data-testid={`lang-${id}`}
                    onClick={() => pickLang(id)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] font-medium text-fg ${
                      on ? "border-accent bg-accentsoft" : "border-bd bg-bdsoft hover:border-fg3"
                    }`}
                  >
                    {name}{on && <Check size={13} className="text-accent" />}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section icon={Wrench} title="Lifecycle hooks" desc="Hooks are injected into every worker prompt so runs start cleanly and leave useful artifacts.">
            <div className="space-y-2">
              {HOOKS.map((h) => (
                <ToggleRow key={h.id} item={h} checked={!!harness.hooks[h.id]} onToggle={() => toggle("hooks", h.id)} />
              ))}
            </div>
          </Section>

          <Section icon={Bot} title="Agent presets" desc="These presets describe the workers the orchestrator expects to have available across the desktop fleet.">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {AGENTS.map((a) => (
                <ToggleRow key={a.id} item={a} checked={!!harness.agents[a.id]} onToggle={() => toggle("agents", a.id)} />
              ))}
            </div>
          </Section>

          <Section icon={GraduationCap} title="Skill packs" desc="Skills are concrete work habits that make node outputs useful to the synthesizer.">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SKILLS.map((s) => (
                <ToggleRow key={s.id} item={s} checked={!!harness.skills[s.id]} onToggle={() => toggle("skills", s.id)} />
              ))}
            </div>
          </Section>

          <Section icon={ShieldCheck} title="Run guardrails" desc="Guardrails keep autonomous desktop runs from stalling or producing unstructured handoffs.">
            <div className="space-y-2">
              {GUARDRAILS.map((g) => (
                <ToggleRow key={g.id} item={g} checked={!!harness.guardrails[g.id]} onToggle={() => toggle("guardrails", g.id)} />
              ))}
            </div>
          </Section>

          <Section icon={Route} title="Connected fleet roles" desc="A read-only view of the roles the harness instructions are applied to when tasks are dispatched.">
            <div className="space-y-2">
              {machines.map((n) => {
                const r = roleOf(n.id);
                const Icon = r.icon;
                return (
                  <div key={n.id} className="flex items-center gap-3 rounded-lg border border-bd bg-bdsoft px-3 py-2.5">
                    <Icon size={16} strokeWidth={2} className="shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[12.5px] text-fg">{n.id}.fleet.local</div>
                      <div className="text-[11px] text-fg3">{r.label}</div>
                    </div>
                    <div className="font-mono text-[11px] text-fg3">
                      {n.provides.hardware.cpu}c · {n.provides.hardware.ram_gb}GB{n.provides.hardware.gpu ? " · GPU" : ""}
                    </div>
                  </div>
                );
              })}
              {machines.length === 0 && <div className="text-[12px] text-fg3">no machines connected</div>}
            </div>
          </Section>

          <Section icon={FileCheck2} title="What gets injected" desc="For transparency, this is the kind of harness context added before each user task.">
            <div className="rounded-lg border border-bd bg-[#0b0e14] p-3 font-mono text-[11px] leading-relaxed text-fg2">
              Active AgentOS harness: inspect local role, use enabled skills, write artifacts, then hand off concisely.
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
