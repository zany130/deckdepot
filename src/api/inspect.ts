export function collectedNames(value: unknown, maxDepth = 3): string[] {
  const names = new Set<string>();
  let current: unknown = value;
  let depth = 0;
  while (current && (typeof current === "object" || typeof current === "function") && depth < maxDepth) {
    try {
      for (const name of Object.getOwnPropertyNames(current)) {
        if (name !== "constructor") {
          names.add(name);
        }
      }
    } catch {
      break;
    }
    current = Object.getPrototypeOf(current);
    depth += 1;
  }
  return [...names].sort();
}

export function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  const kind = typeof value;
  if (kind === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    return `function arity=${fn.length}`;
  }
  if (kind === "object") {
    return Array.isArray(value) ? "array" : "object";
  }
  return kind;
}
