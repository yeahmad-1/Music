/**
 * IndexedDB storage helper for persisting imported and downloaded audio files
 * in web browsers (Safari, Chrome, Firefox, Edge, Mobile Safari).
 * Converts audio to ArrayBuffers to prevent DataCloneError on WebKit/Safari.
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

      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => {
          this.dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  async storeAudio(id: string, data: Blob | ArrayBuffer): Promise<string> {
    try {
      const db = await this.getDB();
      let buffer: ArrayBuffer;
      let mimeType = 'audio/mpeg';

      if (data instanceof Blob) {
        mimeType = data.type || 'audio/mpeg';
        buffer = await data.arrayBuffer();
      } else {
        buffer = data;
      }

      const blob = new Blob([buffer], { type: mimeType });

      return new Promise((resolve, reject) => {
        const tx = db.transaction('audioFiles', 'readwrite');
        const store = tx.objectStore('audioFiles');

        // Store both buffer (universal compatibility) and metadata
        const record = {
          id,
          buffer,
          type: mimeType,
          size: buffer.byteLength,
          updatedAt: Date.now(),
        };

        store.put(record);

        tx.oncomplete = () => {
          const url = URL.createObjectURL(blob);
          resolve(url);
        };

        tx.onerror = () => {
          reject(tx.error || new Error('Transaction failed'));
        };
      });
    } catch (err) {
      this.dbPromise = null;
      throw err;
    }
  }

  async getAudioUrl(id: string): Promise<string | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('audioFiles', 'readonly');
        const store = tx.objectStore('audioFiles');
        const req = store.get(id);

        req.onsuccess = () => {
          const res = req.result;
          if (!res) {
            resolve(null);
            return;
          }

          let blob: Blob | null = null;

          // Format 1: New universal ArrayBuffer format
          if (res.buffer && (res.buffer instanceof ArrayBuffer || ArrayBuffer.isView(res.buffer))) {
            blob = new Blob([res.buffer], { type: res.type || 'audio/mpeg' });
          }
          // Format 2: Direct Blob object
          else if (res.blob instanceof Blob) {
            blob = res.blob;
          } else if (res instanceof Blob) {
            blob = res;
          }
          // Format 3: Legacy data field
          else if (res.data instanceof Blob) {
            blob = res.data;
          } else if (res.data && (res.data instanceof ArrayBuffer || ArrayBuffer.isView(res.data))) {
            blob = new Blob([res.data], { type: res.type || 'audio/mpeg' });
          }

          if (blob && blob.size > 0) {
            const url = URL.createObjectURL(blob);
            resolve(url);
          } else {
            resolve(null);
          }
        };

        req.onerror = () => {
          resolve(null);
        };
      });
    } catch {
      this.dbPromise = null;
      return null;
    }
  }

  async hasAudio(id: string): Promise<boolean> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('audioFiles', 'readonly');
        const store = tx.objectStore('audioFiles');
        const req = store.count(id);
        req.onsuccess = () => resolve((req.result || 0) > 0);
        req.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  async deleteAudio(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('audioFiles', 'readwrite');
        const store = tx.objectStore('audioFiles');
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      this.dbPromise = null;
    }
  }
}

export const webAudioStorage = new WebAudioStorage();
