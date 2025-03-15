import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, OAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getDatabase, ref, set, child, get } from 'firebase/database';

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

export { auth, GoogleAuthProvider, microsoftProvider, signInWithPopup };