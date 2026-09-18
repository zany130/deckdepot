import { createElement } from "react";
import {
  EUIMode,
  afterPatch,
  findInReactTree,
  findSP,
  getReactRoot,
  sleep,
  type Patch,
} from "@decky/ui";
import { FaBoxOpen } from "react-icons/fa";
import { PLUGIN_DISPLAY_NAME, STORE_ROUTE } from "../constants";

/**
 * Optional Steam Gaming Mode main-menu injection.
 *
 * Current Decky has no official menu API (decky-loader#308 closed unmerged).
 * This client still mounts Steam's undocumented `MainNavMenuContainer`.
 *
 * 2026-09-17 steamui: menu rows are descriptor-driven. Route rows render as
 * `Ae` with `{route, label, icon, onGamepadFocus}`. The leaf control uses
 * `action`, not `onFocus`. Cloning a live `Ae` row onto `/deckdepot` is the
 * current contract.
 */

const LOG_PREFIX = "[DeckDepot] menu injection";
const ITEM_KEY = "deckdepot-steam-menu";
const WRAPPER_MARK = "__deckdepotMainMenuWrapper";
const MAX_ATTEMPTS = 20;
const RETRY_MS = 250;

type InjectResult =
  | { kind: "injected"; uninstall: () => void; detail: Record<string, unknown> }
  | { kind: "retry"; reason: string; detail?: Record<string, unknown> }
  | { kind: "skip"; reason: string; detail?: Record<string, unknown> };

function log(message: string, extra?: unknown): void {
  if (extra === undefined) {
    console.log(`${LOG_PREFIX}: ${message}`);
    return;
  }
  console.log(`${LOG_PREFIX}: ${message}`, extra);
}

function isRouteMenuItem(node: unknown): boolean {
  if (!node || typeof node !== "object") {
    return false;
  }
  const item = node as { props?: Record<string, unknown>; type?: unknown };
  return Boolean(
    item.type &&
      item.props &&
      typeof item.props.label !== "undefined" &&
      typeof item.props.route === "string"
  );
}

function isDeckDepotItem(node: unknown): boolean {
  if (!node || typeof node !== "object") {
    return false;
  }
  const item = node as {
    key?: unknown;
    props?: { route?: string; label?: unknown };
  };
  return (
    item.key === ITEM_KEY ||
    item.props?.route === STORE_ROUTE ||
    item.props?.label === PLUGIN_DISPLAY_NAME
  );
}

function hostWindows(): Window[] {
  const windows: Window[] = [];
  const add = (win: Window | null | undefined) => {
    if (win && !windows.includes(win)) {
      windows.push(win);
    }
  };
  try {
    add(findSP());
  } catch {
    // findSP is best-effort.
  }
  add(window);
  return windows;
}

function asFiber(root: unknown): unknown {
  if (!root || typeof root !== "object") {
    return null;
  }
  const record = root as { current?: unknown; child?: unknown };
  if (record.current && typeof record.current === "object") {
    return record.current;
  }
  return root;
}

function walkFiber(
  node: unknown,
  match: (fiber: Record<string, unknown>) => boolean,
  seen = new Set<unknown>()
): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || seen.has(node)) {
    return null;
  }
  seen.add(node);
  const fiber = node as Record<string, unknown>;
  if (match(fiber)) {
    return fiber;
  }
  return (
    walkFiber(fiber.child, match, seen) || walkFiber(fiber.sibling, match, seen)
  );
}

function findMenuContainer(): {
  win: Window;
  fiber: Record<string, unknown>;
} | null {
  for (const win of hostWindows()) {
    try {
      const rootEl = win.document.getElementById("root");
      if (!rootEl) {
        continue;
      }
      const tree = asFiber(getReactRoot(rootEl));
      const fiber = walkFiber(
        tree,
        (node) =>
          (node.memoizedProps as { navID?: string } | undefined)?.navID ===
            "MainNavMenuContainer" ||
          (node.pendingProps as { navID?: string } | undefined)?.navID ===
            "MainNavMenuContainer"
      );
      if (fiber) {
        return { win, fiber };
      }
    } catch {
      // Try the next window.
    }
  }
  return null;
}

async function gamepadUiAvailable(): Promise<{ ok: boolean; mode: number | null }> {
  try {
    const mode = await (
      window as unknown as {
        SteamClient?: { UI?: { GetUIMode?: () => Promise<number> } };
      }
    ).SteamClient?.UI?.GetUIMode?.();
    if (typeof mode !== "number") {
      return { ok: true, mode: null };
    }
    return { ok: mode === EUIMode.GamePad, mode };
  } catch {
    return { ok: true, mode: null };
  }
}

function findMenuItems(tree: unknown): unknown[] | null {
  const found = findInReactTree(
    tree,
    (node) => Array.isArray(node) && node.some(isRouteMenuItem)
  );
  return Array.isArray(found) ? found : null;
}

function insertIndex(items: unknown[]): number {
  const library = items.findIndex(
    (item) => (item as { key?: unknown }).key === "library"
  );
  if (library >= 0) {
    return library + 1;
  }
  const first = items.findIndex(isRouteMenuItem);
  if (first < 0) {
    return Math.max(0, items.length - 1);
  }
  return first + 1;
}

function cloneMenuItem(sample: {
  type: unknown;
  props: Record<string, unknown>;
}): unknown {
  return createElement(sample.type as never, {
    ...sample.props,
    key: ITEM_KEY,
    route: STORE_ROUTE,
    label: PLUGIN_DISPLAY_NAME,
    active: "if-within-route",
    icon: createElement(FaBoxOpen),
  });
}

function innerMenuTarget(rendered: unknown): { node: { type?: unknown } } | null {
  const children = (
    rendered as {
      props?: { children?: { props?: { children?: unknown } } };
    }
  )?.props?.children?.props?.children;
  if (Array.isArray(children) && children[0] && typeof children[0] === "object") {
    return { node: children[0] as { type?: unknown } };
  }
  if (children && typeof children === "object" && "type" in (children as object)) {
    return { node: children as { type?: unknown } };
  }
  return null;
}

function tryInject(): InjectResult {
  const found = findMenuContainer();
  if (!found) {
    return {
      kind: "retry",
      reason: "Steam MainNavMenuContainer fiber not found",
      detail: {
        titles: hostWindows().map((win) => win.document.title),
        roots: hostWindows().map((win) => Boolean(win.document.getElementById("root"))),
      },
    };
  }

  const parent = found.fiber.return as
    | { type?: unknown; alternate?: { type?: unknown } }
    | undefined;
  const original = parent?.type as ((props: unknown) => unknown) & {
    [WRAPPER_MARK]?: boolean;
    prototype?: { render?: unknown };
  };
  if (!parent || typeof original !== "function" || original.prototype?.render) {
    return {
      kind: "skip",
      reason: "MainNavMenuContainer parent is not a function component",
      detail: { parentType: typeof parent?.type },
    };
  }
  if (original[WRAPPER_MARK]) {
    return { kind: "skip", reason: "already wrapped" };
  }

  let innerPatch: Patch | null = null;
  let patchedInnerType: unknown = null;
  let lastItemCount = 0;

  const wrapper = (props: unknown) => {
    const rendered = original(props);
    try {
      const target = innerMenuTarget(rendered);
      if (!target?.node) {
        return rendered;
      }
      if (!patchedInnerType && typeof target.node.type === "function") {
        innerPatch = afterPatch(target.node, "type", (_args, ret) => {
          const items = findMenuItems(ret);
          if (!items) {
            return ret;
          }
          lastItemCount = items.length;
          if (items.some(isDeckDepotItem)) {
            return ret;
          }
          const sample = items.find(isRouteMenuItem) as
            | { type: unknown; props: Record<string, unknown> }
            | undefined;
          if (!sample) {
            return ret;
          }
          items.splice(insertIndex(items), 0, cloneMenuItem(sample));
          return ret;
        });
        patchedInnerType = target.node.type;
      } else if (patchedInnerType) {
        target.node.type = patchedInnerType;
      }
    } catch (exc) {
      log("inner patch failed; leaving Steam menu unchanged", exc);
    }
    return rendered;
  };
  (wrapper as { [WRAPPER_MARK]?: boolean })[WRAPPER_MARK] = true;

  parent.type = wrapper;
  if (parent.alternate) {
    parent.alternate.type = wrapper;
  }

  return {
    kind: "injected",
    detail: { itemCount: lastItemCount, title: found.win.document.title },
    uninstall: () => {
      try {
        innerPatch?.unpatch();
      } catch (exc) {
        log("inner unpatch failed", exc);
      }
      innerPatch = null;
      if (parent.type === wrapper) {
        parent.type = original;
      }
      if (parent.alternate && parent.alternate.type === wrapper) {
        parent.alternate.type = original;
      }
      log("unregistered DeckDepot menu entry");
    },
  };
}

export function installSteamMenuInjection(): () => void {
  let cancelled = false;
  let uninstall: (() => void) | null = null;

  void (async () => {
    try {
      const ui = await gamepadUiAvailable();
      if (!ui.ok) {
        log("skipped: Steam UI is not GamepadUI");
        return;
      }
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !cancelled && !uninstall; attempt += 1) {
        const result = tryInject();
        if (result.kind === "injected") {
          uninstall = result.uninstall;
          log("registered DeckDepot on MainNavMenuContainer");
          return;
        }
        if (result.kind === "skip") {
          log(`skipped: ${result.reason}`);
          return;
        }
        if (attempt === MAX_ATTEMPTS) {
          log(`skipped: ${result.reason}`);
          return;
        }
        await sleep(RETRY_MS);
      }
    } catch (exc) {
      log("skipped after unexpected error", exc);
    }
  })();

  return () => {
    cancelled = true;
    try {
      uninstall?.();
    } catch (exc) {
      log("unload unpatch failed", exc);
    }
    uninstall = null;
  };
}
