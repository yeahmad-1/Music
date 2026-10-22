/**
 * IndexedDB storage helper for persisting imported and downloaded audio files
 * in web browsers (Safari, Chrome, Firefox, Edge, Mobile Safari).
 * Converts audio to ArrayBuffers to prevent DataCloneError on WebKit/Safari.
 * On native platforms (iOS/Android), FileSystem is used instead.
 */

function detectAudioMimeType(buffer: ArrayBuffer, fallback = 'audio/mpeg'): string {
  if (!buffer || buffer.byteLength < 4) return fallback;
  const u8 = new Uint8Array(buffer.slice(0, 16));

  // MP4 / M4A / AAC container: contains 'ftyp' at offset 4
  if (u8.length >= 8 && u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
    return 'audio/mp4';
  }
  // WebM / Matroska: 0x1A 0x45 0xDF 0xA3
  if (u8.length >= 4 && u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3) {
    return 'audio/webm';
  }
  // OGG: 'OggS'
  if (u8.length >= 4 && u8[0] === 0x4f && u8[1] === 0x67 && u8[2] === 0x67 && u8[3] === 0x53) {
    return 'audio/ogg';
  }
  // WAV: 'RIFF'
  if (u8.length >= 4 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) {
    return 'audio/wav';
  }
  // AAC ADTS: 0xFF 0xF1 or 0xFF 0xF9
  if (u8.length >= 2 && u8[0] === 0xff && (u8[1] & 0xf6) === 0xf0) {
    return 'audio/aac';
  }
  // MP3: 'ID3' or MPEG frame sync (0xFF 0xE0+)
  if (u8.length >= 3 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) {
    return 'audio/mpeg';
  }
  if (u8.length >= 2 && u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }

  return fallback;
}

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
      let hintMime = 'audio/mpeg';

      if (data instanceof Blob) {
        hintMime = data.type || 'audio/mpeg';
        buffer = await data.arrayBuffer();
      } else {
        buffer = data;
      }

      const mimeType = detectAudioMimeType(buffer, hintMime);
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

          // Format 1: Universal ArrayBuffer format (most robust across all browsers)
          if (res.buffer && (res.buffer instanceof ArrayBuffer || ArrayBuffer.isView(res.buffer))) {
            const rawBuf: ArrayBuffer = res.buffer instanceof ArrayBuffer ? res.buffer : res.buffer.buffer;
            const properMime = detectAudioMimeType(rawBuf, res.type || 'audio/mpeg');
            blob = new Blob([rawBuf], { type: properMime });
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
            const rawBuf: ArrayBuffer = res.data instanceof ArrayBuffer ? res.data : res.data.buffer;
            const properMime = detectAudioMimeType(rawBuf, res.type || 'audio/mpeg');
            blob = new Blob([rawBuf], { type: properMime });
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
