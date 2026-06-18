import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, OAuthProvider, signInWithPopup, signOut, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getDatabase, ref, set, child, get, connectDatabaseEmulator } from 'firebase/database';

const firebaseConfig = {
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
if (import.meta.env.VITE_FIREBASE_EMULATOR === 'true') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(getDatabase(app), '127.0.0.1', 9000);
    window.__E2E_AUTH__ = { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword };
}

export { auth, GoogleAuthProvider, microsoftProvider, signInWithPopup };