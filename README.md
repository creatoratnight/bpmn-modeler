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

### Contributing

Contributions are welcome! Please open an issue or submit a pull request.

### License

This project is licensed under the MIT License.