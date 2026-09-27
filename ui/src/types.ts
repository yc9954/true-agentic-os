export type NodeStatus = "idle" | "busy" | "offline";

export interface Capabilities {
  tools: string[];
  hardware: { cpu: number; ram_gb: number; gpu: string | null };
  data: string[];
  load: number;
}

export interface NodeDescriptor {
  id: string;
  name: string;
  container: string;
  endpoint: string;
  vncPort: number;
  connected: boolean;
  ready: boolean;
  status: NodeStatus;
  provides: Capabilities;
  currentTaskId: string | null;
}

export interface DiscoveredMachine {
  id: string;
  name: string;
  vncPort: number;
  provides: Capabilities;
  connected: boolean;
  available: boolean; // machine exists (can be added/booted)
  powered: boolean; // currently running
}

export type TaskStatus = "queued" | "routing" | "running" | "done" | "error" | "canceled";

export interface Task {
  id: string;
  prompt: string;
  target: string;
  assignedNodeIds: string[];
  status: TaskStatus;
  startedAt: number;
}

export type LogKind = "system" | "command" | "text" | "tool" | "result" | "error";

export interface WorkspaceFile {
  name: string;
  size: number;
}

export type ServerEvent =
  | { type: "snapshot"; nodes: NodeDescriptor[]; tasks: Task[] }
  | { type: "node_status"; nodeId: string; status: NodeStatus; load: number; ready: boolean }
  | { type: "task_created"; task: Task }
  | { type: "task_status"; taskId: string; nodeId: string; status: TaskStatus }
  | { type: "node_files"; nodeId: string; files: WorkspaceFile[] }
  | { type: "agent_reply"; taskId: string; text: string }
  | { type: "agent_stream"; id: string; role: "orchestrator" | "assistant"; text: string }
  | { type: "task_log"; taskId: string; nodeId: string; kind: LogKind; line: string };
