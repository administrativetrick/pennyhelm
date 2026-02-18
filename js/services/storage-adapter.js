/**
 * StorageAdapter — abstracts backend persistence (Firestore, Express, localStorage).
 *
 * Extracted from Store to decouple data management from transport layer.
 * Provides a uniform interface regardless of backend mode.
 */

const STORAGE_KEY = 'personal_finances_data';

export class StorageAdapter {
    constructor() {
        this._mode = 'selfhost'; // 'selfhost' or 'cloud'
        this._authProvider = null;
        this._db = null;
        this._dataDocRef = null;
        this._serverAvailable = false;
        this._syncTimer = null;

        // Impersonation state (admin only)
        this._impersonatingUid = null;
        this._realUid = null;
    }

    // ─── Configuration ────────────────────────────

    setMode(mode) { this._mode = mode; }
    getMode() { return this._mode; }
    isCloud() { return this._mode === 'cloud'; }

    setAuthProvider(fn) { this._authProvider = fn; }

    initFirestore(uid) {
        this._db = firebase.firestore();
        this._dataDocRef = this._db.collection('userData').doc(uid);
    }

    getFirestore() { return this._db; }
    isServerAvailable() { return this._serverAvailable; }

    _getAuthHeaders() {
        return this._authProvider ? this._authProvider() : {};
    }

    // ─── Impersonation (admin only) ───────────────

    startImpersonation(targetUid) {
        if (!this._realUid) {
            this._realUid = this._dataDocRef.id;
        }
        this._impersonatingUid = targetUid;
        this._dataDocRef = this._db.collection('userData').doc(targetUid);
    }

    stopImpersonation() {
        if (this._realUid) {
            this._impersonatingUid = null;
            this._dataDocRef = this._db.collection('userData').doc(this._realUid);
            this._realUid = null;
        }
    }

    isImpersonating() { return this._impersonatingUid !== null; }
    getImpersonatedUid() { return this._impersonatingUid; }

    // ─── Load ─────────────────────────────────────

    async load(options = {}) {
        if (this._mode === 'cloud') {
            return this._loadFromFirestore(options);
        }
        return this._loadFromExpress();
    }

    async _loadFromFirestore(options = {}) {
        try {
            console.log('[StorageAdapter] Loading from Firestore, docRef:', this._dataDocRef?.path);
            const getOptions = options.forceServer ? { source: 'server' } : {};
            const docSnap = await this._dataDocRef.get(getOptions);
            console.log('[StorageAdapter] Doc exists:', docSnap.exists);

            if (docSnap.exists) {
                const raw = docSnap.data().data;
                const serverData = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (serverData && typeof serverData === 'object' && 'bills' in serverData) {
                    this._serverAvailable = true;
                    return serverData;
                }
                this._serverAvailable = true;
                console.warn('[StorageAdapter] Data exists but failed validation');
                return null;
            }

            this._serverAvailable = true;
            // Check localStorage for migration
            const migrated = this._loadFromLocalStorage();
            if (migrated) {
                console.log('Migrating data from localStorage to Firestore...');
                await this._saveToFirestore(migrated);
                localStorage.removeItem(STORAGE_KEY);
                console.log('Migration complete. localStorage cleared.');
                return migrated;
            }
            return null;
        } catch (e) {
            console.warn('Firestore not available, falling back to localStorage:', e);
            return this._loadFromLocalStorage();
        }
    }

    async _loadFromExpress() {
        try {
            const res = await fetch('/api/data', {
                headers: this._getAuthHeaders()
            });
            if (res.status === 401) {
                window.location.href = '/login';
                return null;
            }
            const serverData = await res.json();

            if (serverData && typeof serverData === 'object' && 'bills' in serverData) {
                this._serverAvailable = true;
                return serverData;
            }

            this._serverAvailable = true;
            const migrated = this._loadFromLocalStorage();
            if (migrated) {
                console.log('Migrating data from localStorage to server...');
                await this._saveToExpress(migrated);
                localStorage.removeItem(STORAGE_KEY);
                console.log('Migration complete. localStorage cleared.');
                return migrated;
            }
            return null;
        } catch (e) {
            console.warn('Server not available, falling back to localStorage:', e);
            return this._loadFromLocalStorage();
        }
    }

    _loadFromLocalStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.error('Failed to load from localStorage:', e);
            return null;
        }
    }

    // ─── Save (debounced) ─────────────────────────

    scheduleSave(data) {
        if (!this._serverAvailable) return;
        clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => {
            this.saveImmediate(data);
        }, 100);
    }

    async saveImmediate(data) {
        if (this._mode === 'cloud') {
            return this._saveToFirestore(data);
        }
        return this._saveToExpress(data);
    }

    async forceSave(data) {
        clearTimeout(this._syncTimer);
        return this.saveImmediate(data);
    }

    async _saveToFirestore(data) {
        try {
            const writeData = {
                data: JSON.stringify(data),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (data.sharedWith && Array.isArray(data.sharedWith)) {
                writeData.sharedWithUids = data.sharedWith.map(s => s.uid);
                writeData.sharedWithEdit = data.sharedWith
                    .filter(s => s.permissions === 'edit')
                    .map(s => s.uid);
            }

            await this._dataDocRef.set(writeData, { merge: true });
        } catch (e) {
            console.error('Failed to sync to Firestore:', e);
        }
    }

    async _saveToExpress(data) {
        try {
            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...this._getAuthHeaders() },
                body: JSON.stringify(data)
            });
            if (response.status === 401) {
                window.location.href = '/login';
            }
        } catch (e) {
            console.error('Failed to sync to server:', e);
        }
    }
}
