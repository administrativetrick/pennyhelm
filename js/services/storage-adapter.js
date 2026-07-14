/**
 * StorageAdapter — abstracts backend persistence (Firestore, Express, localStorage).
 *
 * Extracted from Store to decouple data management from transport layer.
 * Provides a uniform interface regardless of backend mode.
 */

const STORAGE_KEY = 'personal_finances_data';

/**
 * Stale-tab guard for Plaid-synced expenses.
 *
 * Cloud saves write the whole data blob (last-write-wins). A tab that
 * loaded before a server-side Plaid sync therefore used to CLOBBER the
 * newer synced transactions on its next save — this destroyed a week of
 * fuel transactions in production (gas budget "showing /usr/bin/bash spent").
 *
 * Before every Firestore write, the current server blob is read and any
 * Plaid transaction (plaidTransactionId) the outgoing blob has never seen
 * is grafted in — unless the user deleted it in this session. Manual
 * expenses are untouched (the client owns those), and the sync watermark
 * never regresses. Returns how many expenses were rescued.
 */
export function mergeServerPlaidExpenses(outgoing, server, deletedPlaidIds = new Set()) {
    if (!server) return 0;
    // Watermark first — it must advance even when there are no expenses to
    // rescue, so a stale tab can't regress lastTransactionSync.
    if (server.lastTransactionSync &&
        (!outgoing.lastTransactionSync || server.lastTransactionSync > outgoing.lastTransactionSync)) {
        outgoing.lastTransactionSync = server.lastTransactionSync;
    }
    const serverExpenses = Array.isArray(server.expenses) ? server.expenses : [];
    if (serverExpenses.length === 0) return 0;
    if (!Array.isArray(outgoing.expenses)) outgoing.expenses = [];
    const have = new Set(outgoing.expenses.map(e => e && e.plaidTransactionId).filter(Boolean));
    let rescued = 0;
    for (const e of serverExpenses) {
        if (!e || !e.plaidTransactionId) continue;          // manual expense — client wins
        if (have.has(e.plaidTransactionId)) continue;       // client already has it
        if (deletedPlaidIds.has(e.plaidTransactionId)) continue; // deleted on purpose this session
        outgoing.expenses.push(e);
        rescued++;
    }
    return rescued;
}

export class StorageAdapter {
    constructor() {
        this._mode = 'selfhost'; // 'selfhost' or 'cloud'
        this._authProvider = null;
        this._db = null;
        this._dataDocRef = null;
        this._serverAvailable = false;
        this._syncTimer = null;

        // Plaid transactions the user deleted THIS session — the stale-tab
        // merge must not resurrect them (session-scoped by design: a fresh
        // load starts from server truth anyway).
        this._deletedPlaidTxnIds = new Set();

        // Impersonation state (admin only)
        this._impersonatingUid = null;
        this._realUid = null;
    }

    /** Store calls this when the user deletes a Plaid-imported expense. */
    noteDeletedPlaidTransaction(plaidTransactionId) {
        if (plaidTransactionId) this._deletedPlaidTxnIds.add(plaidTransactionId);
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
            // Stale-tab guard: rescue server-side Plaid syncs this client
            // hasn't seen before overwriting the blob (see
            // mergeServerPlaidExpenses above).
            try {
                const snap = await this._dataDocRef.get();
                if (snap.exists) {
                    const server = JSON.parse(snap.data().data || '{}');
                    const rescued = mergeServerPlaidExpenses(data, server, this._deletedPlaidTxnIds);
                    if (rescued > 0) console.log('Stale-tab guard: preserved ' + rescued + ' server-synced transaction(s)');
                }
            } catch (mergeErr) {
                // Pre-write read failed (offline?) — proceed with what we have.
            }

            const writeData = {
                data: JSON.stringify(data),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (data.sharedWith && Array.isArray(data.sharedWith)) {
                writeData.sharedWithUids = data.sharedWith.map(s => s.uid);
                writeData.sharedWithEdit = data.sharedWith
                    .filter(s => s.permissions === 'edit')
                    .map(s => s.uid);
                // RBAC role map — must be re-derived on every save (set with
                // merge would otherwise leave stale grants after a revoke).
                // Mirrors deriveSharedRoles in functions/shared/shared-access-model.cjs:
                // entries without a role are legacy (view->viewer, edit->partner).
                const roles = {};
                for (const s of data.sharedWith) {
                    if (!s || !s.uid) continue;
                    roles[s.uid] = {
                        role: ['companion', 'advisor', 'viewer', 'partner', 'full'].includes(s.role)
                            ? s.role
                            : (s.permissions === 'edit' ? 'partner' : 'viewer'),
                        accountIds: Array.isArray(s.accountIds) ? s.accountIds : null,
                        budgetIds: Array.isArray(s.budgetIds) ? s.budgetIds : null,
                        canEditBudgets: s.canEditBudgets === true,
                    };
                }
                writeData.sharedRoles = roles;
            }

            // mergeFields (not merge:true): merge deep-merges map fields, which
            // would leave a revoked user's entry lingering inside sharedRoles.
            // mergeFields replaces each listed field wholesale.
            await this._dataDocRef.set(writeData, { mergeFields: Object.keys(writeData) });
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
