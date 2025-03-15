import { child, get, getDatabase, ref, set, query, orderByChild, equalTo } from "firebase/database";
import { GoogleAuthProvider, signInWithPopup, signOut, fetchSignInMethodsForEmail, linkWithCredential, OAuthProvider, EmailAuthProvider } from "firebase/auth";
import { auth, microsoftProvider } from '../config/.firebase.js';
import axios from 'axios';
import { encode } from 'base64-arraybuffer';

export const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        console.log('Successfully signed in with Google: ', user);

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
        if (error.code === 'auth/account-exists-with-different-credential') {
            const email = error.customData.email;
            const pendingCred = GoogleAuthProvider.credentialFromError(error);
            const microsoftProvider = new OAuthProvider('microsoft.com');
                signInWithPopup(auth, microsoftProvider).then((microsoftResult) => {
                    // Link the Google credential to the existing user
                    linkWithCredential(microsoftResult.user, pendingCred).then(() => {
                        console.log('Google account linked to existing user.');
                    }).catch((linkError) => {
                        console.error('Error linking Google account: ', linkError);
                    });
                }).catch((microsoftSignInError) => {
                    console.error('Error signing in with Microsoft: ', microsoftSignInError);
                });
        } else {
            console.error('Error during Google sign-in: ', error);
        }
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

export const signInWithMicrosoft = async () => {
    try {
        const result = await signInWithPopup(auth, microsoftProvider);
        const user = result.user;
        console.log('Successfully signed in with Microsoft: ', user);

        // Fetch the user's avatar from Microsoft Graph API
        const accessToken = result._tokenResponse.oauthAccessToken;
        const graphResponse = await axios.get('https://graph.microsoft.com/v1.0/me/photo/$value', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            responseType: 'arraybuffer'
        });

        const userAvatar = `data:image/jpeg;base64,${encode(graphResponse.data)}`;
        console.log('User avatar fetched from Microsoft Graph API.', userAvatar);

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
                    imageUrl: userAvatar,
                    lastLogin: new Date().toISOString()
                });
            } else {
                console.log('New user added to the database.');
                // Add new user data
                set(userRef, {
                    email: user.email,
                    displayName: user.displayName,
                    imageUrl: userAvatar,
                    createdAt: new Date().toISOString()
                });
            }
        }).catch((error) => {
            console.error(error);
        });

    } catch (error) {
        if (error.code === 'auth/account-exists-with-different-credential') {
            const email = error.customData.email;
            const pendingCred = OAuthProvider.credentialFromError(error);
            const googleProvider = new GoogleAuthProvider();
                    signInWithPopup(auth, googleProvider).then((googleResult) => {
                        // Link the Microsoft credential to the existing user
                        linkWithCredential(googleResult.user, pendingCred).then(() => {
                            console.log('Microsoft account linked to existing user.');
                        }).catch((linkError) => {
                            console.error('Error linking Microsoft account: ', linkError);
                        });
                    }).catch((googleSignInError) => {
                        console.error('Error signing in with Google: ', googleSignInError);
                    });
        } else {
            console.error('Error during Microsoft sign-in: ', error);
        }
    }
};