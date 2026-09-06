import test from "node:test";
import assert from "node:assert/strict";
import { dishIndex, findDish } from "./dishLookup";
import { parseBulkFixedGroceryInput } from "./fixedGroceryProductChoice";

const GERECHTEN = [
  { id: "r1", title: "Pasta Pesto" },
  { id: "r2", title: "Boerenkoolstamppot" },
];

/** Zoals de pagina het gebruikt: eerst de lijstparser, dan de herkenning. */
function herkend(invoer: string, gerechten = GERECHTEN) {
  const index = dishIndex(gerechten);
  return parseBulkFixedGroceryInput(invoer).map((line) => findDish(line.searchTerm, index)?.title ?? null);
}

test("een gerecht wordt herkend, ook met een aanloopje ervoor", () => {
  assert.deepEqual(herkend("pasta pesto"), ["Pasta Pesto"]);
  assert.deepEqual(herkend("we eten pasta pesto"), ["Pasta Pesto"]);
  assert.deepEqual(herkend("vanavond maken we boerenkoolstamppot"), ["Boerenkoolstamppot"]);
});

test("een gedeeltelijke treffer is geen gerecht", () => {
  // Wie "pasta" op zijn lijstje zet wil een pak pasta, geen zes ingrediënten.
  assert.deepEqual(herkend("pasta"), [null]);
  assert.deepEqual(herkend("pesto"), [null]);
  assert.deepEqual(herkend("pasta pesto saus"), [null]);
});

test("de volgorde van de woorden maakt niet uit, hoofdletters ook niet", () => {
  assert.deepEqual(herkend("Pesto pasta"), ["Pasta Pesto"]);
});

test("twee gerechten met dezelfde woorden leveren geen keuze op", () => {
  // Dan zou het van de databasevolgorde afhangen welk recept je krijgt.
  const dubbel = [
    { id: "r1", title: "Pasta pesto" },
    { id: "r2", title: "Pesto pasta" },
  ];
  assert.deepEqual(herkend("pasta pesto", dubbel), [null]);
});

test("een lijstje met gerechten en producten door elkaar", () => {
  assert.deepEqual(herkend("melk, pasta pesto, bananen"), [null, "Pasta Pesto", null]);
});
