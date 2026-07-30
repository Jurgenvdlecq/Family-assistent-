import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { hashHouseholdPassword, normalizeUsername, validateCredentialsShape } from "@/domain/household/credentials";

export { hashHouseholdPassword };

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
        passwordHash: hashHouseholdPassword(householdId, password),
      },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new Error("Deze gebruikersnaam is al in gebruik door een ander huishouden. Kies een andere.");
    }
    throw error;
  }
}

async function getLegacySingleHousehold() {
  const households = await prisma.household.findMany({
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (households.length === 1 && households[0].username === null) {
    return households[0];
  }
  return null;
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
  const household = await prisma.household.findUnique({
    where: { username: normalizeUsername(username) },
  });

  if (household?.passwordHash) {
    const attemptedHash = hashHouseholdPassword(household.id, password);
    if (attemptedHash.length === household.passwordHash.length) {
      const matches = crypto.timingSafeEqual(
        Buffer.from(attemptedHash, "hex"),
        Buffer.from(household.passwordHash, "hex")
      );
      if (matches) {
        await createHouseholdSession(household.id);
        return household;
      }
    }
  }

  throw new Error("Deze inloggegevens kloppen niet.");
}
