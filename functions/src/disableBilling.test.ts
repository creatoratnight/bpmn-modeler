// GCLOUD_PROJECT and DATABASE_URL are injected from src/config/.firebase.js
// via jest.setup.js — no hardcoded values here.

// Mock firebase-functions so onMessagePublished simply returns the handler directly.
jest.mock("firebase-functions/v2/pubsub", () => ({
  onMessagePublished: (_topic: string, handler: unknown) => handler,
}));

// CloudBillingClient is instantiated at module level in disableBilling.ts.
// We store the mock methods inside the constructor so the already-created
// instance shares the same jest.fn() references we can configure per test.
const mockGetProjectBillingInfo = jest.fn();
const mockUpdateProjectBillingInfo = jest.fn();

jest.mock("@google-cloud/billing", () => ({
  CloudBillingClient: jest.fn().mockImplementation(() => ({
    getProjectBillingInfo: mockGetProjectBillingInfo,
    updateProjectBillingInfo: mockUpdateProjectBillingInfo,
  })),
}));

import { disableOnBudgetAlert } from "./disableBilling";

/** Build a minimal Pub/Sub CloudEvent with the given budget payload. */
function makeEvent(payload: object) {
  return {
    data: {
      message: {
        data: Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
    },
  };
}

describe("disableOnBudgetAlert", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("takes no action when cost is below budget", async () => {
    await (disableOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 3, budgetAmount: { units: 5 } })
    );

    expect(mockGetProjectBillingInfo).not.toHaveBeenCalled();
    expect(mockUpdateProjectBillingInfo).not.toHaveBeenCalled();
  });

  it("takes no action when billing is already disabled", async () => {
    mockGetProjectBillingInfo.mockResolvedValue([{ billingEnabled: false }]);

    await (disableOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 10, budgetAmount: { units: 5 } })
    );

    expect(mockGetProjectBillingInfo).toHaveBeenCalledTimes(1);
    expect(mockUpdateProjectBillingInfo).not.toHaveBeenCalled();
  });

  it("disables billing when cost equals the budget and billing is enabled", async () => {
    mockGetProjectBillingInfo.mockResolvedValue([{ billingEnabled: true }]);
    mockUpdateProjectBillingInfo.mockResolvedValue([{}]);

    await (disableOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 5, budgetAmount: { units: 5 } })
    );

    expect(mockUpdateProjectBillingInfo).toHaveBeenCalledTimes(1);
    expect(mockUpdateProjectBillingInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        name: `projects/${process.env.GCLOUD_PROJECT}`,
        projectBillingInfo: { billingAccountName: "" },
      })
    );
  });

  it("disables billing when cost exceeds the budget and billing is enabled", async () => {
    mockGetProjectBillingInfo.mockResolvedValue([{ billingEnabled: true }]);
    mockUpdateProjectBillingInfo.mockResolvedValue([{}]);

    await (disableOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 99, budgetAmount: { units: 5 } })
    );

    expect(mockUpdateProjectBillingInfo).toHaveBeenCalledTimes(1);
  });

  it("checks billing status for the correct project", async () => {
    mockGetProjectBillingInfo.mockResolvedValue([{ billingEnabled: true }]);
    mockUpdateProjectBillingInfo.mockResolvedValue([{}]);

    await (disableOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 10, budgetAmount: { units: 5 } })
    );

    expect(mockGetProjectBillingInfo).toHaveBeenCalledWith(
      expect.objectContaining({ name: `projects/${process.env.GCLOUD_PROJECT}` })
    );
  });
});
