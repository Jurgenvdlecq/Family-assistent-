import test from "node:test";
import assert from "node:assert/strict";
import { parseFeedbackReason, replacementPenaltyForReason } from "./feedbackReasons";

test("parseFeedbackReason accepteert alleen gecontroleerde redenen", () => {
  assert.equal(parseFeedbackReason("TOO_MUCH_EFFORT"), "TOO_MUCH_EFFORT");
  assert.equal(parseFeedbackReason("random vrije tekst"), undefined);
});

test("TOO_MUCH_EFFORT telt niet als smaakafkeur", () => {
  assert.equal(replacementPenaltyForReason("TOO_MUCH_EFFORT"), 0);
});

test("NOT_TASTY telt zwaarder dan te vaak gehad", () => {
  assert.ok(replacementPenaltyForReason("NOT_TASTY") > replacementPenaltyForReason("TOO_REPETITIVE"));
});
