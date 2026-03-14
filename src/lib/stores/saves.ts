import { browser } from '$app/environment';
import { del, get, set } from 'idb-keyval';
import { writable } from 'svelte/store';

const STORAGE_KEY = 'tabemap:saves';

function createSavesStore() {
  const { subscribe, set: setStore, update } = writable<Set<string>>(new Set());

  async function hydrate() {
    if (!browser) {
      return;
    }

    const saved = (await get<string[]>(STORAGE_KEY)) ?? [];
    setStore(new Set(saved));
  }

  async function persist(next: Set<string>) {
    if (!browser) {
      return;
    }

    if (next.size === 0) {
      await del(STORAGE_KEY);
      return;
    }

    await set(STORAGE_KEY, [...next]);
  }

  return {
    subscribe,
    hydrate,
    async toggle(id: string) {
      let snapshot = new Set<string>();
      update((current) => {
        snapshot = new Set(current);
        if (snapshot.has(id)) {
          snapshot.delete(id);
        } else {
          snapshot.add(id);
        }
        return snapshot;
      });
      await persist(snapshot);
    }
  };
}

export const savesStore = createSavesStore();
