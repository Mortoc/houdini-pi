import { type HoudiniBridge, MemoryStore } from "@houdini-pi/pi-package";
import type { LinkGroup } from "@houdini-pi/protocol";
import type { HoudiniPort } from "./hub.js";

interface SceneContextLite {
  hip: string | null;
}

/** The hub's view of Houdini: hip path, memory and undo, all through the bridge. */
export function houdiniPort(bridge: HoudiniBridge): HoudiniPort {
  const memory = new MemoryStore(bridge);
  return {
    hipPath: async () => (await bridge.runHelper<SceneContextLite>("scene_context")).hip ?? undefined,
    loadHip: async (path) => {
      await bridge.runHelper("load_hip", { path });
    },
    linkGroup: async () => (await bridge.runHelper<{ group: LinkGroup | null }>("get_link_group")).group ?? undefined,
    setLinkGroup: async (group) => {
      await bridge.runHelper("set_link_group", { group });
    },
    memoryRead: async () => {
      const snapshot = await memory.snapshot();
      return { text: snapshot.text, prevAvailable: snapshot.prev !== null };
    },
    memoryReplace: (text) => memory.replace(text),
    memoryRollback: () => memory.rollback(),
    undoTurn: async () => {
      await bridge.execute("scene.undo");
    },
  };
}
