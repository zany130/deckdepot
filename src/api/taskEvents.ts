import { addEventListener, removeEventListener } from "@decky/api";
import { TASK_EVENT_NAME } from "../constants";
import { TaskProgress } from "../types/flatpak";

type TaskHandler = (payload: TaskProgress) => void;

const handlers = new Set<TaskHandler>();
let pluginListener: ((...args: unknown[]) => void) | null = null;

function asPayload(args: unknown[]): TaskProgress | null {
  const first = args[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return null;
  }
  const value = first as Partial<TaskProgress>;
  if (typeof value.taskId !== "string" || typeof value.appId !== "string") {
    return null;
  }
  return value as TaskProgress;
}

export function installTaskEventBridge(): void {
  if (pluginListener) {
    return;
  }
  pluginListener = (...args: unknown[]) => {
    const payload = asPayload(args);
    if (!payload) {
      return;
    }
    for (const handler of handlers) {
      handler(payload);
    }
  };
  addEventListener(TASK_EVENT_NAME, pluginListener);
}

export function removeTaskEventBridge(): void {
  if (!pluginListener) {
    return;
  }
  removeEventListener(TASK_EVENT_NAME, pluginListener);
  pluginListener = null;
  handlers.clear();
}

export function subscribeTaskEvents(handler: TaskHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
