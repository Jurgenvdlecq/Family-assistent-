import { prisma } from "./prisma";

/**
 * Alle harde beperkingen van gezinsleden die normaal gesproken meeeten,
 * samengevoegd tot één lijst. Eén allergie van één aanwezig gezinslid moet
 * het hele huishouden uitsluiten van een gerecht (sectie 10 van de
 * Blueprint) — vandaar geen per-persoon uitsplitsing hier, alleen de
 * vereniging. Per-dag aanwezigheid bestaat nog niet (alleen
 * `defaultPresent`); tot die er is, tellen alle standaard-aanwezige
 * gezinsleden mee voor elke dag.
 */
export async function getHouseholdHardRestrictions(householdId: string): Promise<string[]> {
  const persons = await prisma.person.findMany({
    where: { householdId, defaultPresent: true },
    select: { hardRestrictions: true },
  });

  const combined: string[] = [];
  for (const person of persons) {
    if (Array.isArray(person.hardRestrictions)) {
      combined.push(...(person.hardRestrictions as string[]));
    }
  }
  return combined;
}
