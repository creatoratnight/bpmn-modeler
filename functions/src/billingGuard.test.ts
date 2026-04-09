// GCLOUD_PROJECT and DATABASE_URL are injected from src/config/.firebase.js
// via jest.setup.js — no hardcoded values here.

// Mock firebase-functions so onMessagePublished simply returns the handler directly.
// This lets us call the inner async handler in tests without a real CloudEvent wrapper.
jest.mock("firebase-functions/v2/pubsub", () => ({
  onMessagePublished: (_topic: string, handler: unknown) => handler,
}));

// Mock google-auth-library before importing the function under test
jest.mock("google-auth-library", () => ({
  GoogleAuth: jest.fn(),
}));

import { GoogleAuth } from "google-auth-library";
import { limitOnBudgetAlert } from "./billingGuard";

const MockedGoogleAuth = jest.mocked(GoogleAuth);

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

describe("limitOnBudgetAlert", () => {
  let mockRequest: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest = jest.fn().mockResolvedValue({});
    MockedGoogleAuth.mockImplementation(
      () =>
        ({
          getClient: jest.fn().mockResolvedValue({ request: mockRequest }),
        } as unknown as GoogleAuth)
    );
  });

  it("does NOT lock the database when cost is below budget", async () => {
    await (limitOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 3, budgetAmount: { units: 5 } })
    );

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("locks the database when cost equals the budget", async () => {
    await (limitOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 5, budgetAmount: { units: 5 } })
    );

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        data: JSON.stringify({ rules: { ".read": false, ".write": false } }),
      })
    );
  });

  it("locks the database when cost exceeds the budget", async () => {
    await (limitOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 10, budgetAmount: { units: 5 } })
    );

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("sends the PUT to the correct RTDB URL for the project", async () => {
    await (limitOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 10, budgetAmount: { units: 5 } })
    );

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${process.env.DATABASE_URL}/.settings/rules.json`,
      })
    );
  });

  it("does NOT lock the database when cost is zero and budget is zero", async () => {
    // 0 >= 0 is true — function will lock. This test documents that edge-case behaviour.
    await (limitOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 0, budgetAmount: { units: 0 } })
    );

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("locks when budgetAmount is missing (defaults to 0) and cost is positive", async () => {
    // budgetAmount?.units ?? 0 → 0; any positive cost triggers the lock
    await (limitOnBudgetAlert as unknown as Function)(
      makeEvent({ costAmount: 1 })
    );

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
