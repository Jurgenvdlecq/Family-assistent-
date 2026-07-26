import { test } from "node:test";
import assert from "node:assert/strict";
import { calculatePackageRequirement } from "./packages";
import { combineQuantities } from "./units";

test("voorbeeld uit het ontwerpdocument: 900g penne, 100g voorraad, verpakking 500g -> 2 verpakkingen, 200g over", () => {
  const result = calculatePackageRequirement({
    recipeNeed: { amount: 900, unit: "GRAM" },
    inStock: { amount: 100, unit: "GRAM" },
    packageSize: { amount: 500, unit: "GRAM" },
  });
  assert.equal(result.status, "OK");
  assert.deepEqual(result.netNeeded, { amount: 800, unit: "GRAM" });
  assert.equal(result.packagesToBuy, 2);
  assert.deepEqual(result.totalPurchased, { amount: 1000, unit: "GRAM" });
  assert.deepEqual(result.expectedSurplus, { amount: 200, unit: "GRAM" });
});

test("hoeveelheid kleiner dan één verpakking -> toch 1 hele verpakking", () => {
  const result = calculatePackageRequirement({
    recipeNeed: { amount: 150, unit: "GRAM" },
    packageSize: { amount: 500, unit: "GRAM" },
  });
  assert.equal(result.packagesToBuy, 1);
  assert.equal(result.totalPurchased!.amount, 500);
  assert.equal(result.expectedSurplus!.amount, 350);
});

test("exact één verpakking -> geen overschot", () => {
  const result = calculatePackageRequirement({
    recipeNeed: { amount: 500, unit: "GRAM" },
    packageSize: { amount: 500, unit: "GRAM" },
  });
  assert.equal(result.packagesToBuy, 1);
  assert.equal(result.expectedSurplus!.amount, 0);
});

test("iets meer dan één verpakking -> 2 verpakkingen nodig", () => {
  const result = calculatePackageRequirement({
    recipeNeed: { amount: 510, unit: "GRAM" },
    packageSize: { amount: 500, unit: "GRAM" },
  });
  assert.equal(result.packagesToBuy, 2);
  assert.equal(result.expectedSurplus!.amount, 490);
});

test("meerdere recepten met hetzelfde ingrediënt worden eerst gecombineerd", () => {
  const combinedNeed = combineQuantities([
    { amount: 200, unit: "GRAM" }, // recept A
    { amount: 300, unit: "GRAM" }, // recept B
  ]);
  const result = calculatePackageRequirement({
    recipeNeed: combinedNeed,
    packageSize: { amount: 500, unit: "GRAM" },
  });
  assert.equal(result.packagesToBuy, 1);
  assert.equal(result.expectedSurplus!.amount, 0);
});

test("voorraad aftrekken vermindert het aantal te bestellen verpakkingen", () => {
  const withoutStock = calculatePackageRequirement({
    recipeNeed: { amount: 900, unit: "GRAM" },
    packageSize: { amount: 500, unit: "GRAM" },
  });
  const withStock = calculatePackageRequirement({
    recipeNeed: { amount: 900, unit: "GRAM" },
    inStock: { amount: 900, unit: "GRAM" },
    packageSize: { amount: 500, unit: "GRAM" },
  });
  assert.equal(withoutStock.packagesToBuy, 2);
  assert.equal(withStock.status, "NOTHING_NEEDED");
  assert.equal(withStock.packagesToBuy, 0);
});

test("verschillende eenheden: milliliter werkt net zo als gram", () => {
  const result = calculatePackageRequirement({
    recipeNeed: { amount: 700, unit: "ML" },
    packageSize: { amount: 250, unit: "ML" },
  });
  assert.equal(result.packagesToBuy, 3);
  assert.equal(result.totalPurchased!.amount, 750);
});

test("ontbrekende verpakking -> status PACKAGE_UNKNOWN, geen gegokt aantal", () => {
  const result = calculatePackageRequirement({
    recipeNeed: { amount: 400, unit: "GRAM" },
    packageSize: null,
  });
  assert.equal(result.status, "PACKAGE_UNKNOWN");
  assert.equal(result.packagesToBuy, 0);
  assert.equal(result.totalPurchased, null);
  assert.equal(result.expectedSurplus, null);
});

test("ongeldige data: negatieve receptbehoefte geeft een fout", () => {
  assert.throws(() =>
    calculatePackageRequirement({
      recipeNeed: { amount: -10, unit: "GRAM" },
      packageSize: { amount: 500, unit: "GRAM" },
    })
  );
});

test("ongeldige data: verpakking van 0 of negatief geeft een fout", () => {
  assert.throws(() =>
    calculatePackageRequirement({
      recipeNeed: { amount: 400, unit: "GRAM" },
      packageSize: { amount: 0, unit: "GRAM" },
    })
  );
  assert.throws(() =>
    calculatePackageRequirement({
      recipeNeed: { amount: 400, unit: "GRAM" },
      packageSize: { amount: -100, unit: "GRAM" },
    })
  );
});

test("ongeldige data: verpakking in een andere eenheid dan de behoefte geeft een fout", () => {
  assert.throws(() =>
    calculatePackageRequirement({
      recipeNeed: { amount: 400, unit: "GRAM" },
      packageSize: { amount: 1, unit: "ML" },
    })
  );
});

test("decimalen: drijvende-kommaruis leidt niet tot een overbodige extra verpakking", () => {
  // 0.3 / 0.1 is in JavaScript 2.9999999999999996 door drijvende-kommaruis —
  // dat mag niet naar 3 verpakkingen afronden terwijl het er echt 3 zijn... en
  // zeker niet naar boven ophogen wanneer het precies 1.0 hoort te zijn.
  const result = calculatePackageRequirement({
    recipeNeed: { amount: 1.0000000000000002, unit: "GRAM" },
    packageSize: { amount: 1, unit: "GRAM" },
  });
  assert.equal(result.packagesToBuy, 1);
});

test("decimalen: normale kommagetallen ronden gewoon naar boven af", () => {
  const result = calculatePackageRequirement({
    recipeNeed: { amount: 0.6, unit: "GRAM" },
    packageSize: { amount: 0.5, unit: "GRAM" },
  });
  assert.equal(result.packagesToBuy, 2);
});

test("stuksproducten: dezelfde regel geldt voor PIECE als voor GRAM/ML", () => {
  const result = calculatePackageRequirement({
    recipeNeed: { amount: 7, unit: "PIECE" }, // bv. 7 eieren nodig
    packageSize: { amount: 6, unit: "PIECE" }, // verkocht per 6
  });
  assert.equal(result.status, "OK");
  assert.equal(result.packagesToBuy, 2);
  assert.equal(result.totalPurchased!.amount, 12);
  assert.equal(result.expectedSurplus!.amount, 5);
});
