"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disableOnBudgetAlert = void 0;
const pubsub_1 = require("firebase-functions/v2/pubsub");
const billing_1 = require("@google-cloud/billing");
const PROJECT_ID = process.env.GCLOUD_PROJECT;
const billing = new billing_1.CloudBillingClient();
exports.disableOnBudgetAlert = (0, pubsub_1.onMessagePublished)("billing-disable-cutoff", async (event) => {
    var _a, _b, _c;
    const data = JSON.parse(Buffer.from(event.data.message.data, "base64").toString());
    const costAmount = (_a = data.costAmount) !== null && _a !== void 0 ? _a : 0;
    const budgetAmount = (_c = (_b = data.budgetAmount) === null || _b === void 0 ? void 0 : _b.units) !== null && _c !== void 0 ? _c : 0;
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
//# sourceMappingURL=disableBilling.js.map