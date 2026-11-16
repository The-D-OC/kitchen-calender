// Screen-saver photos, stored on the tablet in IndexedDB (too big for localStorage).
// Each upload is shrunk to max 1920px JPEG so hundreds of photos stay small.

const DB_NAME = 'family-calendar-photos';
const STORE = 'photos';
const MAX_SIDE = 1920;

interface Photo {
  id: string;
  blob: Blob;
  added: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read photo'))), 'image/jpeg', 0.85));
}

export async function addPhotos(files: FileList | File[]): Promise<number> {
  let added = 0;
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const blob = await shrink(file);
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await tx('readwrite', (s) => s.put({ id, blob, added: Date.now() } satisfies Photo));
      added++;
    } catch {
      /* skip unreadable files (e.g. HEIC on Android) */
    }
  }
  return added;
}

export const listPhotos = () => tx<Photo[]>('readonly', (s) => s.getAll() as IDBRequest<Photo[]>).catch(() => [] as Photo[]);
export const photoCount = () => tx<number>('readonly', (s) => s.count()).catch(() => 0);
export const clearPhotos = () => tx('readwrite', (s) => s.clear());
export const deletePhoto = (id: string) => tx('readwrite', (s) => s.delete(id));
