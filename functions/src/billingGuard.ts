import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { GoogleAuth } from "google-auth-library";

const DATABASE_URL = process.env.DATABASE_URL;
const DENY_ALL_RULES = JSON.stringify({
    rules: { ".read": false, ".write": false }
});

// Triggered by the Pub/Sub billing alert
export const limitOnBudgetAlert = onMessagePublished("billing-resource-limit", async (event) => {
    const budgetData = JSON.parse(
        Buffer.from(event.data.message.data, "base64").toString()
    );

    const costAmount   = budgetData.costAmount;
    const budgetAmount = budgetData.budgetAmount ?? 0;

    console.log(`Budget alert: spent $${costAmount} of $${budgetAmount}`);

    // Only act if we've actually hit/exceeded the threshold
    if (costAmount >= budgetAmount) {
        console.warn("Budget exceeded — locking Firebase Realtime Database rules");
        await lockRealtimeDatabase();
    }
});

async function lockRealtimeDatabase() {
    const auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/firebase"]
    });
    const client = await auth.getClient();

    // Overwrite the RTDB security rules with deny-all
    const url = `${DATABASE_URL}/.settings/rules.json`;
    await client.request({
        url,
        method: "PUT",
        data: DENY_ALL_RULES,
    });

    console.log("Realtime Database rules set to deny all reads and writes.");
}
