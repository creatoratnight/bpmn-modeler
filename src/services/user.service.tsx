import {child, get, getDatabase, ref, set} from "firebase/database";
import {GoogleAuthProvider, signInWithPopup, signOut} from "firebase/auth";
import {auth} from '../config/.firebase.js';

export const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        // Get reference to the database
        const db = getDatabase();
        const userRef = ref(db, 'users/' + user.uid);

        // Check if the user already exists in the database
        get(child(userRef, '/')).then((snapshot) => {
            if (snapshot.exists()) {
                console.log('User already exists in the database.');
                // Update last login or other relevant fields
                set(userRef, {
                    ...snapshot.val(),
                    email: user.email,
                    displayName: user.displayName,
                    imageUrl: user.photoURL,
                    lastLogin: new Date().toISOString()
                });
            } else {
                console.log('New user added to the database.');
                // Add new user data
                set(userRef, {
                    email: user.email,
                    displayName: user.displayName,
                    imageUrl: user.photoURL,
                    createdAt: new Date().toISOString()
                });
            }
        }).catch((error) => {
            console.error(error);
        });

    } catch (error) {
        console.error('Error during Google sign-in: ', error);
    }
};

export const logout = async () => {
    try {
        await signOut(auth);
        console.log('User signed out');
    } catch (error) {
        console.error('Error signing out: ', error);
    }
};