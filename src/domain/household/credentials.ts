import crypto from "node:crypto";

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Wachtwoordhash, gezouten met het huishouden-ID zodat een wachtwoordhash
 * nooit hergebruikt kan worden om een ander huishouden binnen te komen.
 * De eigenlijke bescherming tegen verwarring tussen twee huishoudens met
 * dezelfde inloggegevens zit niet hier, maar in de unieke `username`-kolom
 * in het Prisma-schema: een gebruikersnaam wijst per definitie naar precies
 * één huishouden. Inloggen is daardoor een directe opzoeking op
 * gebruikersnaam gevolgd door één wachtwoordcontrole (zie
 * signInByCredentials in src/lib/auth.ts) — niet een gok over meerdere
 * huishoudens heen, wat bij twee bewust identieke inlogcombinaties eerder
 * tot een verkeerd huishouden kon leiden.
 */
export function hashHouseholdPassword(householdId: string, password: string): string {
  return hash(`${householdId}:${password}`);
}

/** Geeft een leesbare foutmelding terug, of `null` als de vorm geldig is. */
export function validateCredentialsShape(username: string, password: string): string | null {
  if (normalizeUsername(username).length < 3) return "Kies een gebruikersnaam van minimaal 3 tekens.";
  if (password.length < 6) return "Kies een wachtwoord van minimaal 6 tekens.";
  return null;
}
