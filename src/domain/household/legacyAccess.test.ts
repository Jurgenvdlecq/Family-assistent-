import { test } from "node:test";
import assert from "node:assert/strict";
import { selectLegacySingleHousehold } from "./legacyAccess";

const CUTOFF = new Date("2026-07-31T00:00:00.000Z");
const VOOR_CUTOFF = new Date("2026-07-26T11:43:47.559Z");
const OP_CUTOFF = CUTOFF;
const NA_CUTOFF = new Date("2026-07-31T00:00:00.001Z");

test("een enkel, nog niet gemigreerd huishouden van vóór de grens krijgt legacy-toegang", () => {
  const result = selectLegacySingleHousehold(
    [{ username: null, createdAt: VOOR_CUTOFF }],
    CUTOFF
  );
  assert.notEqual(result, null);
});

test("een enkel huishouden zonder username, maar aangemaakt op of na de grens, krijgt geen legacy-toegang", () => {
  assert.equal(
    selectLegacySingleHousehold([{ username: null, createdAt: OP_CUTOFF }], CUTOFF),
    null,
    "op de grens zelf (niet ervoor) telt als 'na' — vandaar een strikte '<' in de implementatie"
  );
  assert.equal(
    selectLegacySingleHousehold([{ username: null, createdAt: NA_CUTOFF }], CUTOFF),
    null
  );
});

test("een huishouden dat al een username heeft, krijgt nooit legacy-toegang", () => {
  const result = selectLegacySingleHousehold(
    [{ username: "al-geconfigureerd", createdAt: VOOR_CUTOFF }],
    CUTOFF
  );
  assert.equal(result, null);
});

test("geen huishoudens: geen legacy-toegang", () => {
  assert.equal(selectLegacySingleHousehold([], CUTOFF), null);
});

test("meerdere huishoudens, ook als er één zonder username tussen zit: geen stilzwijgende toegang", () => {
  const result = selectLegacySingleHousehold(
    [
      { username: null, createdAt: VOOR_CUTOFF },
      { username: "ander-huishouden", createdAt: VOOR_CUTOFF },
    ],
    CUTOFF
  );
  assert.equal(
    result,
    null,
    "zodra er meer dan één huishouden bestaat, is niet meer ondubbelzinnig welk huishouden 'het' legacy-huishouden is"
  );
});

test("gebruikt de standaard (ingebakken) grens wanneer er geen expliciete cutoff wordt meegegeven", () => {
  // Regressie: de default-parameter zelf moet ook echt een grens in het
  // verleden zijn — anders zou elk nieuw huishouden (createdAt = nu) alsnog
  // stilzwijgend legacy-toegang kunnen krijgen.
  const result = selectLegacySingleHousehold([{ username: null, createdAt: new Date() }]);
  assert.equal(result, null);
});
