import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import {
  DUMMY_PASSWORD_HASH_FOR_TIMING,
  hashHouseholdPassword,
  normalizeUsername,
  validateCredentialsShape,
  verifyHouseholdPassword,
} from "@/domain/household/credentials";
import { selectLegacySingleHousehold } from "@/domain/household/legacyAccess";
import { checkLoginRateLimit, clearLoginAttempts, recordFailedLoginAttempt } from "./loginRateLimit";

const SESSION_COOKIE = "family_assistant_session";
const SESSION_DAYS = 30;

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashSessionToken(token: string): string {
  return hash(`session:${token}`);
}

function sessionExpiry(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
  return expiresAt;
}

function assertCredentialsShape(username: string, password: string) {
  const error = validateCredentialsShape(username, password);
  if (error) throw new Error(error);
}

async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function createHouseholdSession(householdId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = sessionExpiry();
  await prisma.householdSession.create({
    data: { householdId, tokenHash: hashSessionToken(token), expiresAt },
  });
  await setSessionCookie(token, expiresAt);
}

export async function clearHouseholdSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.householdSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

export async function setHouseholdCredentials(householdId: string, username: string, password: string) {
  assertCredentialsShape(username, password);
  try {
    await prisma.household.update({
      where: { id: householdId },
      data: {
        username: normalizeUsername(username),
        passwordHash: hashHouseholdPassword(password),
      },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new Error("Deze gebruikersnaam is al in gebruik door een ander huishouden. Kies een andere.");
    }
    throw error;
  }
}

// SYSTEM_AUDIT.md-vervolg (sectie 9, "getLegacySingleHousehold"): sinds
// WP77 zet elke onboarding (src/app/onboarding/actions.ts) altijd
// meteen een gebruikersnaam+wachtwoord, en rolt het huishouden terug als
// dat mislukt — een normaal aangemaakt huishouden kan dus nooit meer
// zonder `username` blijven staan. Dit legacy-pad blijft alleen bedoeld
// voor een productie-installatie die al vóór WP77 bestond en nog niet via
// `/ons-gezin` is bijgewerkt (zie OPERATIONS.md). Kon in deze sandbox niet
// worden bevestigd of de productie-installatie van de gebruiker inmiddels
// een gebruikersnaam heeft (geen netwerktoegang tot de productiedatabase,
// zie WORKFLOW.md) — vandaar bewust niet stilzwijgend verwijderd.
//
// In plaats daarvan expliciet begrensd (`selectLegacySingleHousehold`,
// src/domain/household/legacyAccess.ts) met een vaste datumgrens: alleen
// een huishouden dat al vóór deze wijziging bestond komt nog in
// aanmerking. Dat sluit het randgeval af dat de audit noemde ("blijft
// voor altijd actief als niemand ooit een gebruikersnaam instelt") voor
// elk toekomstig huishouden — een nieuw aangemaakt huishouden kan door
// deze grens nooit meer via dit pad toegang krijgen, ook niet in het
// (zeer onwaarschijnlijke) geval dat onboarding halverwege crasht vóórdat
// `setHouseholdCredentials` liep. Het bestaande, mogelijk nog niet
// gemigreerde productiehuishouden blijft intussen gewoon werken totdat de
// gebruiker zelf een gebruikersnaam instelt.
async function getLegacySingleHousehold() {
  const households = await prisma.household.findMany({
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  return selectLegacySingleHousehold(households);
}

export async function getCurrentHousehold() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    const session = await prisma.householdSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { household: true },
    });
    if (session && session.expiresAt > new Date()) return session.household;
    store.delete(SESSION_COOKIE);
  }

  return getLegacySingleHousehold();
}

export async function requireCurrentHousehold() {
  const household = await getCurrentHousehold();
  if (household) return household;

  const householdCount = await prisma.household.count();
  redirect(householdCount === 0 ? "/onboarding" : "/login");
}

export async function assertCurrentHousehold(householdId: string) {
  const household = await requireCurrentHousehold();
  if (household.id !== householdId) {
    throw new Error("Je hebt geen toegang tot dit huishouden.");
  }
  return household;
}

/**
 * Logt in op basis van gebruikersnaam+wachtwoord. `username` is uniek over
 * alle huishoudens (zie prisma/schema.prisma), dus een gebruikersnaam wijst
 * per definitie naar precies één huishouden — een directe opzoeking volstaat
 * en is ondubbelzinnig, ook wanneer twee huishoudens ooit bewust hetzelfde
 * wachtwoord zouden proberen te kiezen (dat wordt al bij het instellen
 * geweigerd omdat de gebruikersnaam dan al bezet is, zie
 * setHouseholdCredentials). Één generieke foutmelding voor zowel een
 * onbekende gebruikersnaam als een fout wachtwoord — anders zou een
 * aanvaller kunnen aftasten welke gebruikersnamen al bestaan (WP62).
 */
export async function signInByCredentials(username: string, password: string) {
  // Rate limiting vóór elke opzoeking of hashvergelijking (SYSTEM_AUDIT.md,
  // "Login rate limiting" — WP-vervolg deel A5). De blokmelding is bewust
  // anders dan de generieke "klopt niet"-melding hierboven, maar lekt zelf
  // niets over of de gebruikersnaam bestaat: elke gebruikersnaam kan
  // geblokkeerd raken, dus het feit van blokkering bevestigt niets.
  const rateLimit = await checkLoginRateLimit(username);
  if (rateLimit.blocked) {
    throw new Error("Te veel mislukte inlogpogingen. Probeer het over enkele minuten opnieuw.");
  }

  const household = await prisma.household.findUnique({
    where: { username: normalizeUsername(username) },
  });

  if (household?.passwordHash) {
    const { valid, needsRehash } = verifyHouseholdPassword(household.id, password, household.passwordHash);
    if (valid) {
      // Een geldig legacy-wachtwoord (het oude, ongesalte sha256-formaat)
      // wordt meteen herhasht naar het nieuwe scrypt-formaat — aansluitend
      // op de geslaagde controle, zodat een huishouden dat gewoon blijft
      // inloggen vanzelf overstapt, zonder zelf iets te hoeven doen.
      if (needsRehash) {
        await prisma.household.update({
          where: { id: household.id },
          data: { passwordHash: hashHouseholdPassword(password) },
        });
      }
      await clearLoginAttempts(username);
      await createHouseholdSession(household.id);
      return household;
    }
  } else {
    // Onafhankelijke review (WP83): zonder dit voert een onbekende
    // gebruikersnaam geen enkele hashberekening uit, terwijl een bestaande
    // gebruikersnaam met een fout wachtwoord nu een volle scrypt-berekening
    // kost (~45ms, tegen sha256's ~0.04ms voorheen) — een goed meetbaar
    // timingverschil dat precies zou verraden welke gebruikersnamen bestaan,
    // ondanks de identieke foutmelding hieronder. Deze dummy-berekening (met
    // hetzelfde wachtwoord, tegen een vaste dummy-hash die nooit kan
    // overeenkomen) kost evenveel tijd en trekt de responstijd gelijk. Het
    // resultaat wordt bewust genegeerd.
    verifyHouseholdPassword("dummy-household-id-voor-timing", password, DUMMY_PASSWORD_HASH_FOR_TIMING);
  }

  await recordFailedLoginAttempt(username);
  throw new Error("Deze inloggegevens kloppen niet.");
}
