/**
 * IndexedDB storage helper for persisting imported and downloaded audio files
 * in web browsers (Render / Safari / Chrome).
 * On native platforms (iOS/Android), FileSystem is used instead.
 */

class WebAudioStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(new Error('IndexedDB not supported in this environment'));
      }
      const request = window.indexedDB.open('OfflineMusicAppDB', 1);
      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('audioFiles')) {
          db.createObjectStore('audioFiles', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async storeAudio(id: string, data: Blob | ArrayBuffer): Promise<string> {
    const db = await this.getDB();
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'audio/mpeg' });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audioFiles', 'readwrite');
      const store = tx.objectStore('audioFiles');
      store.put({ id, blob });
      tx.oncomplete = () => {
        const url = URL.createObjectURL(blob);
        resolve(url);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAudioUrl(id: string): Promise<string | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('audioFiles', 'readonly');
        const store = tx.objectStore('audioFiles');
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result && req.result.blob) {
            const url = URL.createObjectURL(req.result.blob);
            resolve(url);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async deleteAudio(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('audioFiles', 'readwrite');
        const store = tx.objectStore('audioFiles');
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore deletion errors on web if not found
    }
  }
}

export const webAudioStorage = new WebAudioStorage();
