### Deploying functions to Firebase
1. Run ```npm run build``` from the functions/ directory to build the functions.
2. Run ```npm run deploy``` from the functions/ directory to deploy the functions to Firebase.

### Testing functions
1. Run ```npm run test``` from the functions/ directory to unit test the functions.
2. Run ```npm run emulate``` from the functions/ directory to emulate the functions locally.
3. Run ```node scripts/trigger-emulator.js billing-resource-limit 10 5``` to trigger the billing-resource-limit pub/sub.
3. Run ```node scripts/trigger-emulator.js billing-disable-cutoff 10 5``` to trigger the billing-disable-cutoff pub/sub.



