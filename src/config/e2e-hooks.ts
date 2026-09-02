// End-to-end test hooks. Guarded by the emulator env so the whole block is
// dead-code-eliminated from production builds. Mirrors the `__E2E_AUTH__` hook
// in .firebase.js and the `__E2E_BPMN__` hook in BpmnModeler.tsx.
//
// `__E2E_DB__` exposes the app's own (emulator-connected) Realtime Database
// handle plus the modular helpers, so tests can seed data — e.g. cross-user
// project membership for a collaboration test — through the exact same database
// connection, namespace, and security rules the app itself uses.
import { getDatabase, ref, get, set, update, remove } from 'firebase/database';

if (import.meta.env.VITE_FIREBASE_EMULATOR === 'true') {
    (window as unknown as Record<string, unknown>).__E2E_DB__ = {
        getDatabase,
        ref,
        get,
        set,
        update,
        remove,
    };
}
