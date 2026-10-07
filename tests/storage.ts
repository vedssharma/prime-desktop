/** Runs `run` with an in-memory localStorage, or one whose every call throws (blocked storage). */
export function withStorage(run: (store: Map<string, string>) => void, failing = false) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  const fail = () => { throw new Error('blocked'); };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: failing ? { getItem: fail, setItem: fail, removeItem: fail } : {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); },
  } });
  try { run(store); } finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete (globalThis as { localStorage?: unknown }).localStorage; }
}
