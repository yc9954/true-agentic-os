import { useCallback, useEffect, useRef, useState } from "react";
import type { NodeDescriptor, ServerEvent, LogKind, TaskStatus, WorkspaceFile } from "./types";

export interface LogLine {
  seq: number;
  taskId: string;
  kind: LogKind;
  line: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "orchestrator" | "status" | "assistant";
  text: string;
  taskId: string;
  streamId?: string; // live-updating message (orchestrator thinking / synthesis)
  streaming?: boolean;
}

export function useFleet() {
  const [nodes, setNodes] = useState<NodeDescriptor[]>([]);
  const [nodeLogs, setNodeLogs] = useState<Record<string, LogLine[]>>({});
  const [orchLog, setOrchLog] = useState<LogLine[]>([]);
  const [nodeTaskStatus, setNodeTaskStatus] = useState<Record<string, TaskStatus>>({});
  const [nodeTaskId, setNodeTaskId] = useState<Record<string, string>>({});
  const [nodeFiles, setNodeFiles] = useState<Record<string, WorkspaceFile[]>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentPrompt, setCurrentPrompt] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const handle = (ev: ServerEvent) => {
      switch (ev.type) {
        case "snapshot":
          setNodes(ev.nodes);
          break;
        case "node_status":
          setNodes((prev) =>
            prev.map((n) =>
              n.id === ev.nodeId
                ? { ...n, status: ev.status, ready: ev.ready, provides: { ...n.provides, load: ev.load } }
                : n,
            ),
          );
          break;
        case "task_created":
          setCurrentPrompt(ev.task.prompt);
          setMessages((p) => [
            ...p,
            { id: seqRef.current++, role: "user", text: ev.task.prompt, taskId: ev.task.id },
          ]);
          break;
        case "node_files":
          setNodeFiles((p) => ({ ...p, [ev.nodeId]: ev.files }));
          break;
        case "agent_reply":
          setMessages((p) => [
            ...p,
            { id: seqRef.current++, role: "assistant", text: ev.text, taskId: ev.taskId },
          ]);
          break;
        case "agent_stream":
          setMessages((p) => {
            const idx = p.findIndex((m) => m.streamId === ev.id);
            if (idx >= 0) {
              const next = p.slice();
              next[idx] = { ...next[idx], text: ev.text, streaming: true };
              return next;
            }
            return [
              ...p,
              { id: seqRef.current++, role: ev.role, text: ev.text, taskId: "", streamId: ev.id, streaming: true },
            ];
          });
          break;
        case "task_log": {
          const line: LogLine = {
            seq: seqRef.current++,
            taskId: ev.taskId,
            kind: ev.kind,
            line: ev.line,
          };
          if (ev.nodeId === "orchestrator") {
            setOrchLog((p) => [...p.slice(-30), line]);
            setMessages((p) => [
              ...p,
              { id: seqRef.current++, role: "orchestrator", text: ev.line, taskId: ev.taskId },
            ]);
          } else {
            setNodeLogs((p) => ({ ...p, [ev.nodeId]: [...(p[ev.nodeId] ?? []), line] }));
          }
          break;
        }
        case "task_status": {
          if (ev.nodeId === "orchestrator") {
            if (ev.status === "done") {
              setMessages((p) => [
                ...p,
                { id: seqRef.current++, role: "status", text: "all nodes done", taskId: ev.taskId },
              ]);
            } else if (ev.status === "error" || ev.status === "canceled") {
              setMessages((p) => [
                ...p,
                { id: seqRef.current++, role: "status", text: `task ${ev.status}`, taskId: ev.taskId },
              ]);
            }
            break;
          }
          if (ev.status === "running") {
            setNodeLogs((p) => ({ ...p, [ev.nodeId]: [] })); // fresh panel for the new task
            setNodeFiles((p) => ({ ...p, [ev.nodeId]: [] }));
            setNodeTaskId((p) => ({ ...p, [ev.nodeId]: ev.taskId }));
          }
          setNodeTaskStatus((p) => ({ ...p, [ev.nodeId]: ev.status }));
          break;
        }
      }
    };

    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/stream`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (m) => handle(JSON.parse(m.data) as ServerEvent);
    };
    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const dispatch = useCallback(async (prompt: string, target: string) => {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, target }),
    });
  }, []);

  const cancelNode = useCallback(
    async (nodeId: string) => {
      const id = nodeTaskId[nodeId];
      if (id) await fetch(`/api/tasks/${id}/cancel`, { method: "POST" });
    },
    [nodeTaskId],
  );

  // Run a distribution PIPELINE assembled on the Automations canvas.
  const runPipeline = useCallback(async (goal: string, steps: PipelineStep[]) => {
    await fetch("/api/pipeline/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, steps }),
    });
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  return {
    nodes,
    nodeLogs,
    orchLog,
    nodeTaskStatus,
    nodeFiles,
    messages,
    currentPrompt,
    connected,
    dispatch,
    cancelNode,
    runPipeline,
    clearMessages,
  };
}

export interface PipelineStep {
  op: string;
  nodeId?: string;
  instruction?: string;
  label?: string;
}
