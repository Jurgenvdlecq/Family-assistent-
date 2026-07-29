import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveHiddenState, type HidingSignal } from "./hiddenRecipes";

function signal(partial: Partial<HidingSignal> & { createdAt: Date }): HidingSignal {
  return { eventType: "CHOSEN", context: {}, reason: null, ...partial };
}

test("geen negatieve signalen -> niet verborgen", () => {
  const result = deriveHiddenState([
    signal({ eventType: "CHOSEN", createdAt: new Date("2026-01-01") }),
  ]);
  assert.equal(result.hidden, false);
  assert.equal(result.negativeSignalCount, 0);
});

test("één negatieve beoordeling verlaagt alleen de score, verbergt nog niet", () => {
  const result = deriveHiddenState([
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-01") }),
  ]);
  assert.equal(result.hidden, false);
  assert.equal(result.negativeSignalCount, 1);
});

test("twee negatieve beoordelingen verbergen het gerecht", () => {
  const result = deriveHiddenState([
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-01") }),
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-05") }),
  ]);
  assert.equal(result.hidden, true);
  assert.equal(result.negativeSignalCount, 2);
});

test("vervangen met reden NOT_TASTY telt mee als negatief signaal", () => {
  const result = deriveHiddenState([
    signal({ eventType: "REPLACED", reason: "NOT_TASTY", createdAt: new Date("2026-01-01") }),
    signal({ eventType: "REPLACED", reason: "NEVER_USE", createdAt: new Date("2026-01-05") }),
  ]);
  assert.equal(result.hidden, true);
});

test("vervangen met een contextuele reden (te veel werk, verkeerde dag) telt niet mee", () => {
  const result = deriveHiddenState([
    signal({ eventType: "REPLACED", reason: "TOO_MUCH_EFFORT", createdAt: new Date("2026-01-01") }),
    signal({ eventType: "REPLACED", reason: "WRONG_DAY", createdAt: new Date("2026-01-02") }),
    signal({ eventType: "REPLACED", reason: "ONLY_THIS_TIME", createdAt: new Date("2026-01-03") }),
  ]);
  assert.equal(result.hidden, false);
  assert.equal(result.negativeSignalCount, 0);
});

test("positieve expliciete feedback telt niet mee als negatief", () => {
  const result = deriveHiddenState([
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: true }, createdAt: new Date("2026-01-01") }),
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: true }, createdAt: new Date("2026-01-02") }),
  ]);
  assert.equal(result.hidden, false);
});

test("herstellen maakt het gerecht weer zichtbaar, ook al waren er eerder twee negatieve signalen", () => {
  const result = deriveHiddenState([
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-01") }),
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-02") }),
    signal({ eventType: "RESTORED", createdAt: new Date("2026-01-03") }),
  ]);
  assert.equal(result.hidden, false);
  assert.equal(result.negativeSignalCount, 0);
});

test("na herstellen telt alleen wat daarna gebeurt weer mee", () => {
  const result = deriveHiddenState([
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-01") }),
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-02") }),
    signal({ eventType: "RESTORED", createdAt: new Date("2026-01-03") }),
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-04") }),
  ]);
  assert.equal(result.hidden, false, "één negatief signaal na herstel is nog niet genoeg om weer te verbergen");
  assert.equal(result.negativeSignalCount, 1);

  const resultAfterSecond = deriveHiddenState([
    ...[],
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-01") }),
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-02") }),
    signal({ eventType: "RESTORED", createdAt: new Date("2026-01-03") }),
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-04") }),
    signal({ eventType: "EXPLICIT_FEEDBACK", context: { positive: false }, createdAt: new Date("2026-01-05") }),
  ]);
  assert.equal(resultAfterSecond.hidden, true, "twee nieuwe negatieve signalen na herstel verbergen het weer");
});
