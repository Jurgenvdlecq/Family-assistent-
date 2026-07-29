import { test } from "node:test";
import assert from "node:assert/strict";
import { logEvent, errorMessage, createCorrelationId } from "./logger";

function captureConsole<T extends "log" | "warn" | "error">(method: T, fn: () => void): string {
  const original = console[method];
  let captured = "";
  console[method] = ((line: string) => {
    captured = line;
  }) as typeof console[T];
  try {
    fn();
  } finally {
    console[method] = original;
  }
  return captured;
}

test("logEvent: redigeert gevoelige sleutels in meta, ook genest", () => {
  const line = captureConsole("warn", () => {
    logEvent({
      level: "warn",
      area: "picnic_auth",
      message: "Picnic-sessie verlopen",
      meta: {
        picnicAuthToken: "geheim-token-123",
        household: { accessCode: "1234", name: "Familie Jansen" },
        path: "/cart/add_product",
      },
    });
  });

  const parsed = JSON.parse(line);
  assert.equal(parsed.meta.picnicAuthToken, "[redacted]");
  assert.equal(parsed.meta.household.accessCode, "[redacted]");
  assert.equal(parsed.meta.household.name, "Familie Jansen");
  assert.equal(parsed.meta.path, "/cart/add_product");
});

test("logEvent: schrijft geldige JSON met verplichte velden", () => {
  const line = captureConsole("log", () => {
    logEvent({ level: "info", area: "meal_plan", message: "Weekplanning gestart", correlationId: "abc-123" });
  });

  const parsed = JSON.parse(line);
  assert.equal(parsed.level, "info");
  assert.equal(parsed.area, "meal_plan");
  assert.equal(parsed.message, "Weekplanning gestart");
  assert.equal(parsed.correlationId, "abc-123");
  assert.ok(typeof parsed.timestamp === "string");
});

test("logEvent: error-niveau gaat naar console.error", () => {
  let usedError = false;
  const originalError = console.error;
  console.error = () => {
    usedError = true;
  };
  try {
    logEvent({ level: "error", area: "picnic_network", message: "Geen verbinding" });
  } finally {
    console.error = originalError;
  }
  assert.equal(usedError, true);
});

test("errorMessage: geeft Error.message terug, anders String(error)", () => {
  assert.equal(errorMessage(new Error("boem")), "boem");
  assert.equal(errorMessage("gewone string"), "gewone string");
  assert.equal(errorMessage(42), "42");
});

test("createCorrelationId: geeft telkens een uniek id terug", () => {
  const a = createCorrelationId();
  const b = createCorrelationId();
  assert.notEqual(a, b);
  assert.ok(a.length > 0);
});
