/** Best-effort browser storage, with session storage and page memory when persistence is denied. */
const memory = new Map<string, string | null>();

function storage(persistent: boolean): Storage | null {
  try {
    return persistent ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

function read(persistent: boolean, key: string): string | null {
  try {
    return storage(persistent)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(persistent: boolean, key: string, value: string | null): boolean {
  try {
    const target = storage(persistent);
    if (!target) {
      return false;
    }
    if (value === null) {
      target.removeItem(key);
    } else {
      target.setItem(key, value);
    }
    return true;
  } catch {
    return false;
  }
}

export function readBrowserMemory(key: string, persistent = false): string | null {
  if (memory.has(key)) {
    return memory.get(key) ?? null;
  }
  const value = read(persistent, key) ?? (persistent ? read(false, key) : null);
  if (value !== null) {
    memory.set(key, value);
  }
  return value;
}

export function keepBrowserMemory(key: string, value: string | null, persistent = false): void {
  memory.set(key, value);
  const saved = write(persistent, key, value);
  if (persistent && (!saved || value === null)) {
    write(false, key, value);
  }
}
