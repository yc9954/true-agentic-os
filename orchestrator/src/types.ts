// Shared types for the orchestrator + UI (the §9 data model in the PRD).

export type NodeStatus = "idle" | "busy" | "offline";

export interface Hardware {
  cpu: number;
  ram_gb: number;
  gpu: string | null; // MVP: declared (possibly fictional) value
}

export interface Capabilities {
  tools: string[];
  hardware: Hardware;
  data: string[];
  load: number; // 0..1
}

export interface NodeDescriptor {
  id: string; // e.g. "node-1"
  name: string;
  container: string; // docker container name, e.g. "tao-desk-node-1"
  endpoint: string; // informational
  vncPort: number; // host port serving this node's live noVNC desktop
  connected: boolean; // has the user added this machine to the fleet?
  ready: boolean; // is the desktop booted enough to show its screen?
  status: NodeStatus;
  provides: Capabilities;
  currentTaskId: string | null;
}

export type TaskTarget = "auto" | "broadcast" | string; // or a node id

export interface TaskRequires {
  tools?: string[];
  gpu?: boolean;
  data?: string[];
}

export type TaskStatus =
  | "queued"
  | "routing"
  | "running"
  | "done"
  | "error"
  | "canceled";

export interface Task {
  id: string;
  prompt: string;
  target: TaskTarget;
  requires: TaskRequires;
  assignedNodeIds: string[];
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  subtasks?: Record<string, string>; // per-node sub-task (distribute mode)
}

export type LogKind = "system" | "command" | "text" | "tool" | "result" | "error";

export interface WorkspaceFile {
  name: string;
  size: number;
}

// WebSocket events: orchestrator -> UI
export type ServerEvent =
  | { type: "snapshot"; nodes: NodeDescriptor[]; tasks: Task[] }
  | { type: "node_status"; nodeId: string; status: NodeStatus; load: number; ready: boolean }
  | { type: "task_created"; task: Task }
  | { type: "task_status"; taskId: string; nodeId: string; status: TaskStatus }
  | { type: "node_files"; nodeId: string; files: WorkspaceFile[] }
  | { type: "agent_reply"; taskId: string; text: string }
  | { type: "agent_stream"; id: string; role: "orchestrator" | "assistant"; text: string }
  | {
      type: "task_log";
      taskId: string;
      nodeId: string;
      kind: LogKind;
      line: string;
    };
