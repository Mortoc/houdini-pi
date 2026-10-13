import { type HoudiniBridge, MemoryStore, ProjectMemoryStore } from "@houdini-pi/pi-package";
import type { HoudiniPort } from "./hub.js";

interface SceneContextLite {
  hip: string | null;
}

/** The hub's view of Houdini: hip path, memory and undo, all through the bridge. */
export function houdiniPort(bridge: HoudiniBridge): HoudiniPort {
  const memory = new MemoryStore(bridge);
  const projectMemory = new ProjectMemoryStore(bridge);
  return {
    hipPath: async () => (await bridge.runHelper<SceneContextLite>("scene_context")).hip ?? undefined,
    action: async (kind, value) => {
      await bridge.runHelper("do_action", { kind, value });
    },
    loadHip: async (path) => {
      await bridge.runHelper("load_hip", { path });
    },
    memoryRead: async () => {
      const snapshot = await memory.snapshot();
      return { text: snapshot.text, prevAvailable: snapshot.prev !== null };
    },
    memoryReplace: (text) => memory.replace(text),
    memoryRollback: () => memory.rollback(),
    projectMemoryRead: async () => {
      const snapshot = await projectMemory.snapshot();
      return { available: snapshot.available, text: snapshot.text, prevAvailable: snapshot.prev !== null };
    },
    projectMemoryReplace: (text) => projectMemory.replace(text),
    undoTurn: async () => {
      await bridge.execute("scene.undo");
    },
  };
}
