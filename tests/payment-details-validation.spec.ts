import { expect, test } from "@playwright/test";

import {
  buildPaymentDetailsValidationError,
  validatePaymentDetails,
  validateStoredPaymentDetails,
} from "../lib/payment-details-validation";

test("normalizes and validates a complete payment payload", () => {
  const result = validatePaymentDetails({
    cardNumber: "4242 4242-4242 4242",
    cardCCV: "1 2 3",
    cardExpiration: "12/50",
    zipCode: "93407",
    license: " 7lbz281 ",
  });

  expect(result.isValid).toBe(true);
  expect(result.missingFields).toEqual([]);
  expect(result.invalidFields).toEqual([]);
  expect(result.normalized).toEqual({
    cardNumber: "4242424242424242",
    cardCCV: "123",
    cardExpiration: "12/50",
    zipCode: "93407",
    license: "7LBZ281",
  });
});

test("reports expired expiration as invalid, not missing", () => {
  const result = validatePaymentDetails({
    cardNumber: "4242424242424242",
    cardCCV: "123",
    cardExpiration: "12/11",
    zipCode: "93407",
    license: "7LBZ281",
  });

  expect(result.isValid).toBe(false);
  expect(result.missingFields).toEqual([]);
  expect(result.invalidFields).toEqual(["cardExpiration"]);
});

test("separates missing and invalid fields in the same payload", () => {
  const result = validatePaymentDetails({
    cardNumber: "",
    cardCCV: "1x2",
    cardExpiration: "13/30",
    zipCode: "??",
    license: "",
  });

  expect(result.isValid).toBe(false);
  expect(result.missingFields).toEqual(["cardNumber", "license"]);
  expect(result.invalidFields).toEqual(["cardCCV", "cardExpiration", "zipCode"]);
});

test("uses profile license fallback when license input is empty", () => {
  const result = validatePaymentDetails(
    {
      cardNumber: "4242424242424242",
      cardCCV: "123",
      cardExpiration: "12/50",
      zipCode: "93407",
      license: "",
    },
    {
      licenseFallback: " 8abc123 ",
    },
  );

  expect(result.isValid).toBe(true);
  expect(result.normalized.license).toBe("8ABC123");
});

test("stored-profile validation ignores CCV but still validates expiration", () => {
  const result = validateStoredPaymentDetails({
    cardNumber: "4242424242424242",
    cardExpiration: "12/11",
    zipCode: "93407",
    license: "7LBZ281",
  });

  expect(result.isValid).toBe(false);
  expect(result.missingFields).toEqual([]);
  expect(result.invalidFields).toEqual(["cardExpiration"]);
});

test("builds missing-field API error payload with contract fields", () => {
  const payload = buildPaymentDetailsValidationError(["cardNumber", "license"], ["cardExpiration"]);
  expect(payload).not.toBeNull();
  expect(payload).toEqual({
    code: "PAYMENT_DETAILS_MISSING",
    error: "Missing payment details. Required: paymentDetails.cardNumber, paymentDetails.license.",
    missingFields: ["cardNumber", "license"],
    invalidFields: ["cardExpiration"],
  });
});

test("builds invalid-field API error payload when nothing is missing", () => {
  const payload = buildPaymentDetailsValidationError([], ["cardExpiration", "zipCode"]);
  expect(payload).not.toBeNull();
  expect(payload).toEqual({
    code: "PAYMENT_DETAILS_INVALID",
    error: "Invalid payment details: paymentDetails.cardExpiration, paymentDetails.zipCode.",
    invalidFields: ["cardExpiration", "zipCode"],
  });
});
