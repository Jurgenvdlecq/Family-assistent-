import { prisma } from "./prisma";
import { normalizeUsername } from "@/domain/household/credentials";

/**
 * Rate limiting voor `/login` (SYSTEM_AUDIT.md, "Login rate limiting").
 *
 * Database-gebaseerd (via `LoginAttempt`, zie prisma/schema.prisma) i.p.v.
 * een in-memory `Map`: de app draait serverless (Vercel), dus in-memory
 * state is niet betrouwbaar gedeeld tussen aanroepen of instanties — een
 * teller die alleen in het geheugen van één koude functie-aanroep leeft, is
 * geen echte bescherming. Dit project heeft geen Redis/KV of vergelijkbare
 * gedeelde cache (geverifieerd tegen `package.json`/`vercel.json`), dus
 * Postgres via Prisma is de enige betrouwbare, al aanwezige gedeelde
 * opslag.
 *
 * Bewust alleen op genormaliseerde gebruikersnaam (niet op IP-adres): dat
 * dekt het dreigingsmodel uit de audit (herhaald gokken tegen één bekende
 * of geraden gebruikersnaam) zonder aanvullende, mogelijk gevoelige
 * client-identificatiegegevens te hoeven bewaren — expliciete productkeuze,
 * geen technische beperking. IP-gebaseerde limitering zou dit aanvullen
 * (beschermt tegen één aanvaller die veel verschillende gebruikersnamen
 * probeert) maar is bewust niet meegenomen in dit werkpakket, zie het
 * eindrapport.
 */
const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS_IN_WINDOW = 8;
/** Opportunistische opschoning bij elke mislukte poging — voorkomt onbegrensde tabelgroei zonder een aparte cron-job. */
const PRUNE_AFTER_HOURS = 24;

function windowStart(now: Date): Date {
  return new Date(now.getTime() - WINDOW_MINUTES * 60 * 1000);
}

export interface LoginRateLimitStatus {
  blocked: boolean;
  attemptsInWindow: number;
}

/** Controleert alleen — registreert zelf geen poging. */
export async function checkLoginRateLimit(username: string, now: Date = new Date()): Promise<LoginRateLimitStatus> {
  const identifier = normalizeUsername(username);
  const attemptsInWindow = await prisma.loginAttempt.count({
    where: { identifier, createdAt: { gte: windowStart(now) } },
  });
  return { blocked: attemptsInWindow >= MAX_ATTEMPTS_IN_WINDOW, attemptsInWindow };
}

/** Registreert een mislukte poging en ruimt meteen oude regels van dit huishouden op. */
export async function recordFailedLoginAttempt(username: string, now: Date = new Date()): Promise<void> {
  const identifier = normalizeUsername(username);
  await prisma.loginAttempt.create({ data: { identifier, createdAt: now } });
  await prisma.loginAttempt.deleteMany({
    where: { identifier, createdAt: { lt: new Date(now.getTime() - PRUNE_AFTER_HOURS * 60 * 60 * 1000) } },
  });
}

/** Wist de teller na een geslaagde login — een terechte gebruiker moet niet nog even "op tocht" blijven staan na één geldige poging. */
export async function clearLoginAttempts(username: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { identifier: normalizeUsername(username) } });
}
