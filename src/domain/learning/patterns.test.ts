import test from "node:test";
import assert from "node:assert/strict";
import { patternConfidence } from "./patterns";

test("patroon-confidence groeit voorzichtig en blijft onder 1", () => {
  assert.equal(patternConfidence(1), 0.43);
  assert.equal(patternConfidence(3), 0.79);
  assert.equal(patternConfidence(10), 0.9);
});
