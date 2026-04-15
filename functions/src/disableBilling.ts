import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { CloudBillingClient } from "@google-cloud/billing";

const PROJECT_ID = process.env.GCLOUD_PROJECT!;
const billing = new CloudBillingClient();

export const disableOnBudgetAlert = onMessagePublished("billing-disable-cutoff", async (event) => {
    const data = JSON.parse(
        Buffer.from(event.data.message.data, "base64").toString()
    );

    const costAmount   = data.costAmount   ?? 0;
    const budgetAmount = data.budgetAmount ?? 0;

    console.log(`Billing alert: $${costAmount} spent of $${budgetAmount} budget`);

    if (costAmount < budgetAmount) {
        console.log("Under budget, no action taken.");
        return;
    }

    // Check if billing is already disabled to avoid unnecessary API calls
    const [{ billingEnabled }] = await billing.getProjectBillingInfo({
        name: `projects/${PROJECT_ID}`,
    });

    if (!billingEnabled) {
        console.log("Billing already disabled.");
        return;
    }

    // Remove the billing account — this stops ALL billable resources
    console.warn("Budget exceeded — disabling billing account!");
    await billing.updateProjectBillingInfo({
        name: `projects/${PROJECT_ID}`,
        projectBillingInfo: { billingAccountName: "" }, // empty string = remove billing
    });

    console.log("Billing successfully disabled.");
});
