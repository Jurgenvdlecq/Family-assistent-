import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseComponents, describeComponentChoice, type ComponentGroupLike } from "./mealComposition";

const AVG: ComponentGroupLike[] = [
  {
    id: "basis",
    role: "BASE",
    name: "Aardappel",
    sortOrder: 0,
    options: [{ id: "blokjes", name: "Aardappelblokjes", ingredientId: "aardappel" }],
  },
  {
    id: "vlees",
    role: "PROTEIN",
    name: "Vlees",
    sortOrder: 1,
    options: [
      { id: "hamburger", name: "Hamburger", ingredientId: "hamburger" },
      { id: "schnitzel", name: "Schnitzel", ingredientId: "schnitzel" },
      { id: "kipburger", name: "Kipburger", ingredientId: "kipburger" },
    ],
  },
  {
    id: "groente",
    role: "VEGETABLE",
    name: "Groente",
    sortOrder: 2,
    options: [
      { id: "sperzie", name: "Sperziebonen", ingredientId: "sperzie" },
      { id: "snij", name: "Snijbonen", ingredientId: "snij" },
      { id: "bloemkool", name: "Bloemkool", ingredientId: "bloemkool" },
      { id: "broccoli", name: "Broccoli", ingredientId: "broccoli" },
    ],
  },
];

function choose(overrides: Partial<Parameters<typeof chooseComponents>[0]> = {}) {
  return chooseComponents({
    groups: AVG,
    usedThisWeek: new Set(),
    recencyByOptionId: new Map(),
    ...overrides,
  });
}

test("chooseComponents: kiest één optie per component", () => {
  const choices = choose();
  assert.deepEqual(
    choices.map((choice) => choice.group.role),
    ["BASE", "PROTEIN", "VEGETABLE"]
  );
});

test("chooseComponents: is deterministisch — dezelfde invoer geeft dezelfde uitkomst", () => {
  // Geen Math.random: twee keer plannen mag nooit twee verschillende weken
  // opleveren, anders is "waarom staat dit er?" niet te beantwoorden.
  const first = choose().map((choice) => choice.option.id);
  const second = choose().map((choice) => choice.option.id);
  assert.deepEqual(first, second);
});

test("chooseComponents: wat deze week al gekozen is komt niet nog een keer", () => {
  // Dit is de eis "dinsdag en vrijdag niet dezelfde combinatie".
  const tuesday = choose();
  const usedThisWeek = new Set(tuesday.map((choice) => choice.option.id));
  const friday = choose({ usedThisWeek });

  const tuesdayProtein = tuesday.find((choice) => choice.group.role === "PROTEIN")!.option.id;
  const fridayProtein = friday.find((choice) => choice.group.role === "PROTEIN")!.option.id;
  const tuesdayVeg = tuesday.find((choice) => choice.group.role === "VEGETABLE")!.option.id;
  const fridayVeg = friday.find((choice) => choice.group.role === "VEGETABLE")!.option.id;

  assert.notEqual(fridayProtein, tuesdayProtein, "vrijdag hoort ander vlees te krijgen dan dinsdag");
  assert.notEqual(fridayVeg, tuesdayVeg, "vrijdag hoort andere groente te krijgen dan dinsdag");
});

test("chooseComponents: een component met maar één optie herhaalt gewoon", () => {
  // Aardappel is er maar in één soort. Die overslaan zou betekenen: geen
  // aardappel bij een AVG-avond — erger dan herhaling.
  const tuesday = choose();
  const friday = choose({ usedThisWeek: new Set(tuesday.map((choice) => choice.option.id)) });
  assert.equal(friday.find((choice) => choice.group.role === "BASE")?.option.id, "blokjes");
});

test("chooseComponents: wat vorige week gekozen is scoort lager dan iets wat langer geleden was", () => {
  const choices = choose({
    recencyByOptionId: new Map([
      ["broccoli", 0],
      ["bloemkool", 1],
      ["sperzie", 2],
    ]),
  });
  const vegetable = choices.find((choice) => choice.group.role === "VEGETABLE")!.option.id;
  assert.equal(vegetable, "snij", "snijbonen zijn nog nooit geweest en horen dus voor te gaan");
});

test("chooseComponents: van twee eerder gekozen opties wint degene die het langst geleden was", () => {
  const groups: ComponentGroupLike[] = [
    {
      id: "groente",
      role: "VEGETABLE",
      name: "Groente",
      sortOrder: 0,
      options: [
        { id: "broccoli", name: "Broccoli", ingredientId: "broccoli" },
        { id: "bloemkool", name: "Bloemkool", ingredientId: "bloemkool" },
      ],
    },
  ];
  const choices = chooseComponents({
    groups,
    usedThisWeek: new Set(),
    recencyByOptionId: new Map([
      ["broccoli", 0],
      ["bloemkool", 3],
    ]),
  });
  assert.equal(choices[0].option.id, "bloemkool");
});

test("chooseComponents: twee componenten pakken nooit hetzelfde ingrediënt", () => {
  const groups: ComponentGroupLike[] = [
    {
      id: "groente-1",
      role: "VEGETABLE",
      name: "Groente",
      sortOrder: 0,
      options: [{ id: "broccoli-a", name: "Broccoli", ingredientId: "broccoli" }],
    },
    {
      id: "groente-2",
      role: "SIDE",
      name: "Extra groente",
      sortOrder: 1,
      options: [
        { id: "broccoli-b", name: "Nog meer broccoli", ingredientId: "broccoli" },
        { id: "wortel", name: "Wortel", ingredientId: "wortel" },
      ],
    },
  ];
  const choices = chooseComponents({ groups, usedThisWeek: new Set(), recencyByOptionId: new Map() });
  assert.deepEqual(
    choices.map((choice) => choice.option.id),
    ["broccoli-a", "wortel"]
  );
});

test("chooseComponents: een component zonder opties levert geen keuze op", () => {
  // Kan gebeuren als alle opties door een allergie zijn weggevallen. Beter
  // een component overslaan dan een onveilige optie kiezen.
  const choices = chooseComponents({
    groups: [{ id: "leeg", role: "PROTEIN", name: "Vlees", sortOrder: 0, options: [] }],
    usedThisWeek: new Set(),
    recencyByOptionId: new Map(),
  });
  assert.deepEqual(choices, []);
});

test("describeComponentChoice: noemt de reden in gewone taal", () => {
  const choices = choose({ recencyByOptionId: new Map([["broccoli", 0]]) });
  const text = describeComponentChoice("AVG", choices);
  assert.match(text, /^AVG/);
  assert.ok(text.endsWith("."), "de uitleg is een zin, geen fragment");
});

test("describeComponentChoice: zonder bijzonderheden een rustige zin, geen lege opsomming", () => {
  const text = describeComponentChoice("AVG", [
    { group: AVG[0], option: AVG[0].options[0], reason: null },
  ]);
  assert.equal(text, "AVG zoals jullie dat meestal doen.");
});
