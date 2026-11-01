const DB_NAME = 'modexa3d';
const DB_VERSION = 1;
const STORE = 'models';

/** An uploaded 3D file kept on this device. */
export interface StoredModel {
  id: string;
  name: string;
  blob: Blob;
  savedAt: number;
}

/** Tiny IndexedDB wrapper: one object store holding uploaded .glb files. */
export class ModelDb {
  private connection: Promise<IDBDatabase> | null = null;

  async put(model: StoredModel): Promise<void> {
    await this.request('readwrite', (store) => store.put(model));
    // Best effort: asks the browser not to clear this data when space runs low
    void navigator.storage?.persist?.();
  }

  get(id: string): Promise<StoredModel | undefined> {
    return this.request('readonly', (store) => store.get(id));
  }

  async delete(id: string): Promise<void> {
    await this.request('readwrite', (store) => store.delete(id));
  }

  async keys(): Promise<string[]> {
    const keys = await this.request('readonly', (store) => store.getAllKeys());
    return keys.map(String);
  }

  private open(): Promise<IDBDatabase> {
    this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // If opening failed, the next call tries again instead of reusing the failure
    return this.connection.catch((error) => {
      this.connection = null;
      throw error;
    });
  }

  private async request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      // Writes are only safe once the whole transaction completed (a full disk aborts it)
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
    });
  }
}