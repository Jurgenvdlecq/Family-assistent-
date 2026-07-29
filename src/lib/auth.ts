import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";

const SESSION_COOKIE = "family_assistant_session";
const SESSION_DAYS = 30;

function normalizeAccessCode(accessCode: string): string {
  return accessCode.trim();
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashHouseholdAccessCode(householdId: string, accessCode: string): string {
  return hash(`${householdId}:${normalizeAccessCode(accessCode)}`);
}

function hashSessionToken(token: string): string {
  return hash(`session:${token}`);
}

function sessionExpiry(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
  return expiresAt;
}

function assertAccessCodeShape(accessCode: string) {
  const normalized = normalizeAccessCode(accessCode);
  if (normalized.length < 6) {
    throw new Error("Kies een toegangscode van minimaal 6 tekens.");
  }
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

export async function setHouseholdAccessCode(householdId: string, accessCode: string) {
  assertAccessCodeShape(accessCode);
  await prisma.household.update({
    where: { id: householdId },
    data: { accessCodeHash: hashHouseholdAccessCode(householdId, accessCode) },
  });
}

async function getLegacySingleHousehold() {
  const households = await prisma.household.findMany({
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (households.length === 1 && households[0].accessCodeHash === null) {
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
 * Logt in op basis van alleen de toegangscode, zonder dat de gebruiker eerst
 * een huishouden uit een lijst hoeft te kiezen. `hashHouseholdAccessCode`
 * neemt het huishouden-ID mee in de hash, dus elke code hoort ondubbelzinnig
 * bij precies één huishouden — de juiste rij vinden door de code tegen elk
 * huishouden te proberen is daarmee net zo betrouwbaar als vooraf een
 * huishouden selecteren, maar lekt geen enkele huishoudennaam aan wie het
 * loginscherm bezoekt (WP62).
 */
export async function signInByAccessCode(accessCode: string) {
  const households = await prisma.household.findMany({
    where: { accessCodeHash: { not: null } },
  });

  for (const household of households) {
    const attemptedHash = hashHouseholdAccessCode(household.id, accessCode);
    if (household.accessCodeHash!.length !== attemptedHash.length) continue;
    const matches = crypto.timingSafeEqual(
      Buffer.from(attemptedHash, "hex"),
      Buffer.from(household.accessCodeHash!, "hex")
    );
    if (matches) {
      await createHouseholdSession(household.id);
      return household;
    }
  }

  throw new Error("Deze toegangscode klopt niet.");
}
