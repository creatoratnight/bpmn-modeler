// Application-level settings, safe to edit and committed to the repo.
// (Firebase credentials live in the gitignored .firebase.js, not here.)
const config = {
    // Shown in the browser tab and on the sign-in screen. index.html carries the
    // same text as a placeholder for the moment before the bundle runs.
    appTitle: "BPMN Modeler",
    // appTitle: "Valtimo Designer",
    // Header and sign-in logo. A path under public/ or an absolute URL.
    logoUrl: "/bpmn_modeler_logo.png",
    // logoUrl: "/valtimo-designer-logo.png",

    bpmnModelerVersion: "0.6.1",
    enableGoogleSignIn: true,
    enableMicrosoftSignIn: true,
  };

  export default config;
