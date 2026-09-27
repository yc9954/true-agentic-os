// Node registry: holds fleet state and polls Docker for online/offline status.
import { EventEmitter } from "node:events";
import { CONTAINER_PREFIX, FLEET, VNC_BASE_PORT, containerName } from "./config.js";
import { containerRunning, desktopReady, listFleetContainers } from "./node.js";
import type { NodeDescriptor } from "./types.js";

export class Registry extends EventEmitter {
  private nodes = new Map<string, NodeDescriptor>();

  constructor() {
    super();
    for (const n of FLEET) {
      this.nodes.set(n.id, { ...n, provides: { ...n.provides, load: 0 } });
    }
  }

  // Machines added through the UI live only as Docker containers; re-discover
  // them on boot so they survive an orchestrator restart.
  async discover(): Promise<void> {
    for (const c of await listFleetContainers(CONTAINER_PREFIX)) {
      if (this.nodes.has(c.nodeName)) continue;
      this.nodes.set(c.nodeName, {
        id: c.nodeName,
        name: c.nodeName,
        container: c.name,
        endpoint: `docker://${c.name}`,
        vncPort: c.hostPort ?? this.nextSlot().vncPort,
        connected: false,
        ready: false,
        status: "offline",
        provides: { tools: ["claude_code"], hardware: { cpu: 2, ram_gb: 4, gpu: null }, data: ["/home/node/work"], load: 0 },
        currentTaskId: null,
      });
    }
  }

  // every known/discoverable machine
  all(): NodeDescriptor[] {
    return [...this.nodes.values()];
  }

  // only machines the user has added to the fleet
  list(): NodeDescriptor[] {
    return [...this.nodes.values()].filter((n) => n.connected);
  }

  get(id: string): NodeDescriptor | undefined {
    return this.nodes.get(id);
  }

  // register a newly-provisioned machine (discovered, not yet connected)
  add(node: NodeDescriptor): void {
    this.nodes.set(node.id, node);
  }

  // Reserve the next free node id + noVNC host port. Reserving (rather than
  // just computing) keeps two concurrent "add machine" requests from colliding.
  nextSlot(): { id: string; vncPort: number } {
    let n = this.nodes.size + 1;
    while (this.nodes.has(`node-${n}`)) n++;
    const used = new Set([...this.nodes.values()].map((x) => x.vncPort));
    let port = VNC_BASE_PORT + n;
    while (used.has(port)) port++;
    return { id: `node-${n}`, vncPort: port };
  }

  reserveSlot(): NodeDescriptor {
    const { id, vncPort } = this.nextSlot();
    const node: NodeDescriptor = {
      id,
      name: id,
      container: containerName(id),
      endpoint: `docker://${containerName(id)}`,
      vncPort,
      connected: false,
      ready: false,
      status: "offline",
      provides: { tools: ["claude_code"], hardware: { cpu: 2, ram_gb: 4, gpu: null }, data: ["/home/node/work"], load: 0 },
      currentTaskId: null,
    };
    this.nodes.set(id, node);
    return node;
  }

  remove(id: string): void {
    this.nodes.delete(id);
  }

  // is a (discoverable) machine powered on / reachable?
  async isAvailable(id: string): Promise<boolean> {
    const n = this.nodes.get(id);
    return n ? containerRunning(n.container) : false;
  }

  // add machines to the fleet
  async connect(ids: string[]): Promise<void> {
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (!n) continue;
      n.connected = true;
      n.ready = false; // desktop will boot; becomes ready when its screen is up
      n.status = (await containerRunning(n.container)) ? "idle" : "offline";
      this.emitStatus(n);
    }
  }

  async poll(): Promise<void> {
    for (const node of this.nodes.values()) {
      if (!node.connected) continue;
      const running = await containerRunning(node.container);
      const prevStatus = node.status;
      const prevReady = node.ready;
      if (!running) {
        node.status = "offline";
        node.currentTaskId = null;
        node.provides.load = 0;
        node.ready = false;
      } else {
        if (node.status === "offline") node.status = "idle";
        node.ready = await desktopReady(node.container);
      }
      if (node.status !== prevStatus || node.ready !== prevReady) this.emitStatus(node);
    }
  }

  setBusy(id: string, taskId: string): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.status = "busy";
    n.currentTaskId = taskId;
    n.provides.load = 1;
    this.emitStatus(n);
  }

  // Release a node, but only if it is still working on `taskId` (a newer task
  // may have taken it over in the meantime).
  setIdle(id: string, taskId?: string): void {
    const n = this.nodes.get(id);
    if (!n || n.status === "offline") return;
    if (taskId && n.currentTaskId && n.currentTaskId !== taskId) return;
    n.status = "idle";
    n.currentTaskId = null;
    n.provides.load = 0;
    this.emitStatus(n);
  }

  private emitStatus(n: NodeDescriptor): void {
    this.emit("node_status", { nodeId: n.id, status: n.status, load: n.provides.load, ready: n.ready });
  }
}
