import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, OAuthProvider, signInWithPopup, signOut, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { getDatabase, ref, set, child, get, connectDatabaseEmulator } from 'firebase/database';

const useEmulator = import.meta.env.VITE_FIREBASE_EMULATOR === 'true';

// In emulator/e2e mode use the emulator project's config, so the app and the
// loaded database.rules.json (and its indexes) share ONE namespace
// (demo-bpmn-default-rtdb, matching `--project demo-bpmn` in the emulator
// scripts). Without this the app talks to your real project's namespace on the
// emulator, which gets default open rules with no indexes — causing
// "Index not defined" errors and silently skipping rule enforcement locally.
// Fill the second object with YOUR real project config for `npm run dev`.
const firebaseConfig = useEmulator ? {
    apiKey: "demo-api-key",
    authDomain: "demo-bpmn.firebaseapp.com",
    databaseURL: "https://demo-bpmn-default-rtdb.firebaseio.com",
    projectId: "demo-bpmn",
    storageBucket: "demo-bpmn.appspot.com",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:0000000000000000000000"
} : {
    apiKey: "",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
    measurementId: ""
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const microsoftProvider = new OAuthProvider('microsoft.com');

// End-to-end test mode (`vite --mode e2e`, see .env.e2e): point the SDK at the
// local Firebase emulators and expose a hook so Playwright can sign in without
// the real OAuth popup. The guard keeps this out of production builds entirely.
if (useEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(getDatabase(app), '127.0.0.1', 9000);
    window.__E2E_AUTH__ = { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile };
}

export { auth, GoogleAuthProvider, microsoftProvider, signInWithPopup };