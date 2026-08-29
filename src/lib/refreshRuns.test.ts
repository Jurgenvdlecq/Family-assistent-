/**
 * Integratietest tegen een echte (lokale) Postgres: het vastleggen en
 * teruglezen van prijsverversingen.
 *
 * Waarom dit bestaat: de uitkomst van een verversing stond alleen in een
 * logbestand, en daar heeft de gebruiker niets aan. Deze regels zijn wat er
 * op het scherm komt te staan, dus ze moeten kloppen — vooral het verschil
 * tussen "storing", "deels gelukt", "niets gevonden", "afgebroken" en "nog
 * nooit geprobeerd".
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import {
  describeRefreshRun,
  finishRefreshRun,
  getLastRefreshRuns,
  hasRunningRefresh,
  startRefreshRuns,
} from "./pricing/refreshRuns";
import type { RefreshResult } from "./pricing/refresh";

function result(overrides: Partial<RefreshResult> = {}): RefreshResult {
  return {
    provider: "AH",
    ingredientsChecked: 15,
    productsStored: 40,
    ingredientsWithoutMatch: 2,
    itemsSeen: 30,
    errors: [],
    abortedAfter: null,
    ...overrides,
  };
}

async function cleanup() {
  await prisma.priceRefreshRun.deleteMany({});
}

test("verversingen: de laatste uitslag per winkel komt terug", async () => {
  try {
    const ouder = new Date(Date.now() - 60 * 60 * 1000);
    const oudeIds = await startRefreshRuns(["AH"], "CRON", ouder);
    await finishRefreshRun(oudeIds.get("AH")!, result({ productsStored: 5 }), ouder);

    const ids = await startRefreshRuns(["AH", "DIRK"], "MANUAL");
    await finishRefreshRun(ids.get("AH")!, result({ productsStored: 40 }));
    await finishRefreshRun(ids.get("DIRK")!, result({ provider: "DIRK", productsStored: 12 }));

    const runs = await getLastRefreshRuns(["AH", "DIRK"]);
    assert.equal(runs.get("AH")?.productsStored, 40, "de nieuwste telt, niet die van een uur geleden");
    assert.equal(runs.get("AH")?.trigger, "MANUAL");
    assert.equal(runs.get("DIRK")?.productsStored, 12);
  } finally {
    await cleanup();
  }
});

test("verversingen: een winkel die los is ververst raakt niet uit beeld", async () => {
  // Met één query en een geraden aantal rijen zou de laatste run van de
  // achterblijver stilzwijgend wegvallen, en dan meldt het scherm "nog niet
  // opgehaald" terwijl er wél is opgehaald.
  try {
    const oud = new Date(Date.now() - 60 * 60 * 1000);
    const dirkIds = await startRefreshRuns(["DIRK"], "CRON", oud);
    await finishRefreshRun(dirkIds.get("DIRK")!, result({ provider: "DIRK", productsStored: 9 }), oud);

    // Daarna tien losse AH-verversingen.
    for (let index = 0; index < 10; index += 1) {
      const ids = await startRefreshRuns(["AH"], "MANUAL");
      await finishRefreshRun(ids.get("AH")!, result({ productsStored: index + 1 }));
    }

    const runs = await getLastRefreshRuns(["AH", "DIRK"]);
    assert.equal(runs.get("DIRK")?.productsStored, 9, "de Dirk-run hoort nog steeds gevonden te worden");
  } finally {
    await cleanup();
  }
});

test("verversingen: een storing wordt bewaard, en wist de vorige uitslag niet", async () => {
  try {
    const gisteren = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oudeIds = await startRefreshRuns(["DIRK"], "CRON", gisteren);
    await finishRefreshRun(oudeIds.get("DIRK")!, result({ provider: "DIRK", productsStored: 12 }), gisteren);

    const ids = await startRefreshRuns(["DIRK"], "MANUAL");
    await finishRefreshRun(
      ids.get("DIRK")!,
      result({ provider: "DIRK", productsStored: 0, ingredientsChecked: 0, errors: ["Dirk antwoordde met 403"] })
    );

    const runs = await getLastRefreshRuns(["DIRK"]);
    assert.match(runs.get("DIRK")!.error!, /403/);
    assert.equal(await prisma.priceRefreshRun.count({ where: { provider: "DIRK" } }), 2);
  } finally {
    await cleanup();
  }
});

test("verversingen: alleen de eerste foutmelding wordt bewaard, en niet eindeloos lang", async () => {
  try {
    const ids = await startRefreshRuns(["AH"], "CRON");
    await finishRefreshRun(
      ids.get("AH")!,
      result({ productsStored: 0, errors: ["eerste fout " + "x".repeat(2000), "tweede fout"] })
    );
    const run = (await getLastRefreshRuns(["AH"])).get("AH")!;
    assert.ok(run.error!.startsWith("eerste fout"));
    assert.ok(run.error!.length <= 500, "een foutmelding is geen logbestand");
  } finally {
    await cleanup();
  }
});

test("verversingen: een lopende verversing houdt een tweede tegen, een oude niet", async () => {
  // Twee tabbladen tegelijk zouden de pauze tussen de aanvragen verdubbelen —
  // en een blokkade door de winkel valt dan op de nachtelijke verversing.
  try {
    await startRefreshRuns(["AH", "DIRK"], "MANUAL");
    assert.equal(await hasRunningRefresh(["AH", "DIRK"]), true);

    // Een afgekapte verversing van een uur geleden mag de knop niet blijven
    // blokkeren.
    await cleanup();
    await startRefreshRuns(["AH"], "MANUAL", new Date(Date.now() - 60 * 60 * 1000));
    assert.equal(await hasRunningRefresh(["AH", "DIRK"]), false);
  } finally {
    await cleanup();
  }
});

test("verversingen: een afgebroken verversing is zichtbaar in plaats van onzichtbaar", async () => {
  try {
    await startRefreshRuns(["AH"], "MANUAL");
    const run = (await getLastRefreshRuns(["AH"])).get("AH")!;
    assert.equal(run.finishedAt, null);
    assert.match(describeRefreshRun(run, "Albert Heijn"), /niet afgerond/);
  } finally {
    await cleanup();
  }
});

test("verversingen: de tekst onderscheidt gelukt, deels gelukt, niets gevonden en storing", () => {
  const basis = {
    provider: "AH" as const,
    startedAt: new Date("2026-08-29T05:00:00Z"),
    finishedAt: new Date("2026-08-29T05:02:00Z"),
    ingredientsChecked: 15,
    itemsSeen: 30,
    trigger: "CRON" as const,
  };

  assert.match(
    describeRefreshRun({ ...basis, productsStored: 40, error: null }, "Albert Heijn"),
    /40 producten bijgewerkt/
  );
  // Het vaakst voorkomende geval: bijna alles lukte, één ingrediënt niet. Dan
  // hoort het aantal vóórop te staan, niet de fout.
  assert.match(
    describeRefreshRun({ ...basis, productsStored: 40, error: "Kip: 503" }, "Albert Heijn"),
    /40 producten bijgewerkt.*maar niet alles lukte.*503/
  );
  // Het onderscheid dat op het scherm ontbrak: de winkel gaf wél producten,
  // maar geen daarvan paste — dat vraagt iets heel anders dan een kapotte
  // koppeling die niets teruggeeft.
  assert.match(
    describeRefreshRun({ ...basis, productsStored: 0, error: null }, "Albert Heijn"),
    /30 producten van de winkel gelezen, maar geen daarvan paste/
  );
  assert.match(
    describeRefreshRun({ ...basis, productsStored: 0, itemsSeen: 0, error: null }, "Albert Heijn"),
    /niets van de winkel teruggekregen/
  );
  assert.match(
    describeRefreshRun({ ...basis, productsStored: 0, error: "403 van de winkel" }, "Albert Heijn"),
    /ging mis.*403/
  );
  assert.match(describeRefreshRun(undefined, "Dirk"), /nog niet opgehaald/);
});

test("verversingen: het tijdstip staat in Nederlandse tijd, niet in servertijd", () => {
  // Vercel draait op UTC. Zonder tijdzone meldt de nachtelijke verversing van
  // 05:00 UTC structureel "om 05:00" terwijl de klok van de gebruiker 07:00
  // aanwijst — en een verversing rond middernacht zelfs de verkeerde dag.
  const tekst = describeRefreshRun(
    {
      provider: "AH",
      startedAt: new Date("2026-08-29T05:00:00Z"),
      finishedAt: new Date("2026-08-29T05:02:00Z"),
      ingredientsChecked: 15,
      productsStored: 40,
      itemsSeen: 30,
      error: null,
      trigger: "CRON",
    },
    "Albert Heijn"
  );
  assert.match(tekst, /29 augustus om 07:00/);
});
