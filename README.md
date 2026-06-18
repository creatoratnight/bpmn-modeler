![BPMN Modeler logo](https://bpmn.creatoratnight.com/bpmn_modeler_logo.png)

# bpmn-modeler
Open source BPMN collaboration tool

Live demo: https://bpmn.creatoratnight.com/

## Setup

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation

1. Clone the repository:

    ```sh
    git clone https://github.com/your-username/bpmn-modeler.git
    cd bpmn-modeler
    ```

2. Install the dependencies:

    ```
    npm install
    ```

### Firebase Setup

1. Go to the Firebase Console.
2. Create a new project or select an existing project.
3. Enable the "Realtim Database" for you Firebase project:
   - Setup Rules for the Realtime Database
4. Click on the gear icon next to "Project Overview" and select "Project settings".
5. In the "General" tab, scroll down to "Your apps" and click on the "Web" icon to create a new web app.
6. Register your app with a nickname and click "Register app".
7. Create a copy of `src/config/.example.firebase.js` and rename it to `.firebase.js`.
8. Copy the Firebase configuration object from the Firebase Console paste it into `.firebase.js`.
9. Enable Authentication in Firebase:
   - Go to the "Authentication" section in the Firebase Console.
   - Click on the "Sign-in method" tab.
   - Enable the "Google" sign-in provider and configure it.

### Microsoft Identity Provider Setup (optional)

1. Go to the Azure Portal.
2. Register a new application:
   - Go to "Azure Active Directory" > "App registrations" > "New registration".
   - Enter a name for your application.
   - Select what types of accounts you want to give access
   - Select "Web" as the platform for the redirect URI
   - Set the "Redirect URI" to `https://{firebase-app-id}.firebaseapp.com/__/auth/handler`.
   - Click "Register".
3. Enable the Microsoft sign-in provider in Firebase:
   - Go to the "Authentication" section in the Firebase Console.
   - Click on the "Sign-in method" tab.
   - Enable the "Microsoft" sign-in provider
   - Copy the "Application (client) ID" from Azure to the Firebase provider config
   - Copy the "Client secret" (Manage > Certificates & secrets) from Azure to the Firebase provider config

### Configuration

1. Change the settings in `src/config/config.js` to your likings:
   - Set `enableGoogleSignIn` to `true` if you have setup the Google identity provider in Firebase
   - Set `enableMicrosoftSignIn` to `true` if you have setup the Microsoft AD identity provider in Firebase

### Running the Application

1. Start the development server:
   - `npm run dev`
2. Open your browser and navigate to http://localhost:5173.

### Usage

1. Sign in with Google or Microsoft to access your projects.
2. Create, edit, and save BPMN and DMN models.
3. Collaborate with others in real-time.

### End-to-end tests (Playwright)

End-to-end tests live in `e2e/` and run with [Playwright](https://playwright.dev/).
Authenticated tests sign in against the **Firebase Auth & Database emulators** — no real
Google/Microsoft account, no OAuth popup, and the real database is never touched.

**Prerequisites:**

- Node.js **≥ 20** (the Firebase CLI requires it — see `.nvmrc`, which pins 22). Run `nvm use`.
- Java (JDK) on your `PATH` — the Auth/Database emulators run on the JVM.
- Browser binaries, installed once: `npx playwright install chromium`.

**Run the tests:**

```sh
npm run test:e2e          # boots the emulators, runs the suite, tears them down
npm run test:e2e:report   # open the last HTML report
```

`test:e2e` wraps Playwright in `firebase emulators:exec`, so the emulators start and stop
automatically. Playwright then starts the dev server in e2e mode (`vite --mode e2e`, which
loads `.env.e2e` and sets `VITE_FIREBASE_EMULATOR=true`), pointing the Firebase SDK at the
local emulators.

For interactive UI mode, start the emulators in one terminal and Playwright in another:

```sh
npm run emulators         # terminal 1: Auth (9099) + Database (9000)
npm run test:e2e:ui       # terminal 2
```

**How the login works:** in e2e mode, `src/config/.firebase.js` connects the SDK to the
emulators and exposes a `window.__E2E_AUTH__` hook. The Playwright fixture in
`e2e/fixtures.ts` uses it to create/sign-in a throwaway emulator user before each
authenticated test. The emulator data is wiped on every run, so tests are deterministic.

> The dev server still needs `src/config/.firebase.js` to exist to boot (see Firebase Setup).
> In CI, generate it from `.example.firebase.js` with dummy values — the emulators run in
> demo mode and need no real keys.

### Contributing

Contributions are welcome! Please open an issue or submit a pull request.

### License

This project is licensed under the MIT License.