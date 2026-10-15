export function createMemoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  const calls = [];

  return {
    calls,
    async get(key) {
      if (!data.has(key)) return null;
      return structuredClone(data.get(key));
    },
    async list({ prefix } = {}) {
      const blobs = [];
      for (const key of data.keys()) {
        if (!prefix || String(key).startsWith(prefix)) {
          blobs.push({ key, etag: "1" });
        }
      }
      return { blobs };
    },
    async setJSON(key, value, options = {}) {
      calls.push({ key, options: { ...options } });
      if (options.onlyIfNew && data.has(key)) {
        return { modified: false };
      }
      data.set(key, structuredClone(value));
      return { modified: true, etag: "1" };
    },
    async delete(key) {
      data.delete(key);
    },
    keys() {
      return [...data.keys()];
    },
  };
}
