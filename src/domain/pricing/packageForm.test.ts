import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePackageForm } from "./packageForm";

test("verpakkingsvorm: een aantal maal een inhoud zijn losse porties", () => {
  assert.equal(derivePackageForm("4 x 100 g"), "LOSSE_PORTIES");
  assert.equal(derivePackageForm("6x330ml"), "LOSSE_PORTIES");
});

test("verpakkingsvorm: het aantal mag ook alleen in de productnaam staan", () => {
  // Niet elke winkel zet het aantal in het verpakkingsveld; sommige noteren
  // daar het totaalgewicht.
  assert.equal(derivePackageForm("400 g", "AH Appelmoes 4 x 100 g cups"), "LOSSE_PORTIES");
});

test("verpakkingsvorm: cupjes en knijpzakken tellen ook als losse porties", () => {
  assert.equal(derivePackageForm("400 g", "Appelmoes cupjes"), "LOSSE_PORTIES");
  assert.equal(derivePackageForm("360 g", "Knijpfruit appel"), "LOSSE_PORTIES");
});

test("verpakkingsvorm: één pot is één verpakking", () => {
  assert.equal(derivePackageForm("720 g", "AH Appelmoes"), "EEN_VERPAKKING");
  assert.equal(derivePackageForm("1 l", "AH Halfvolle melk"), "EEN_VERPAKKING");
});

test("verpakkingsvorm: onleesbaar blijft onbekend, en leidt dus nooit tot een oordeel", () => {
  assert.equal(derivePackageForm(null), null);
  assert.equal(derivePackageForm("per stuk verpakt"), null);
});
