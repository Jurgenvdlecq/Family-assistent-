import crypto from "node:crypto";

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

// ── Wachtwoordhashing ───────────────────────────────────────────────────
//
// SYSTEM_AUDIT.md, bevinding 4: het oude formaat was één snelle,
// ongesalte sha256-hash — geen work factor, en afhankelijk van het
// (niet-geheime) `householdId` als saltvervanger. Vervangen door scrypt
// met een echte, willekeurige salt per wachtwoord.
//
// scrypt is bewust gekozen boven bcrypt/argon2: `node:crypto` heeft het
// ingebouwd, dus geen nieuwe dependency die op Vercel's serverless
// functies native gecompileerd zou moeten worden (bcrypt/argon2 zijn
// meestal native modules — precies het soort dependency-risico dat deze
// opdracht expliciet wil vermijden).
//
// Opslagformaat: "scrypt$N$r$p$keylen$saltHex$hashHex" — zelfbeschrijvend
// (algoritme + parameters staan IN de hash, niet in een losse
// moduleconstante) zodat een toekomstige upgrade (bv. een hogere N)
// bestaande hashes niet breekt: elke hash blijft verifieerbaar met de
// parameters waarmee hij destijds is aangemaakt.
const SCRYPT_PREFIX = "scrypt";
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const;
const SCRYPT_SALT_BYTES = 16;

function scryptDerive(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number; keylen: number }
): Buffer {
  return crypto.scryptSync(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p });
}

/**
 * Hasht een wachtwoord met scrypt en een verse, willekeurige salt. Gebruikt
 * voor nieuwe huishoudens, elke bewuste wachtwoordwijziging, en om een
 * geldig legacy-wachtwoord na een geslaagde login te herhashen — nooit meer
 * het oude sha256-formaat.
 */
export function hashHouseholdPassword(password: string): string {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const derived = scryptDerive(password, salt, SCRYPT_PARAMS);
  return [
    SCRYPT_PREFIX,
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    SCRYPT_PARAMS.keylen,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Legacy-formaat (vóór dit werkpakket): sha256(householdId + ":" + password) — altijd precies 64 hex-tekens, zonder scheidingstekens. */
function isLegacyHashFormat(hash: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hash);
}

function legacyHouseholdPasswordHash(householdId: string, password: string): string {
  return crypto.createHash("sha256").update(`${householdId}:${password}`).digest("hex");
}

interface ParsedScryptHash {
  N: number;
  r: number;
  p: number;
  keylen: number;
  salt: Buffer;
  hash: string;
}

/** `null` bij een onbekend of beschadigd formaat — faalt veilig in plaats van te crashen of stilzwijgend "geldig" aan te nemen. */
function parseScryptHash(stored: string): ParsedScryptHash | null {
  const parts = stored.split("$");
  if (parts.length !== 7 || parts[0] !== SCRYPT_PREFIX) return null;

  const [, nRaw, rRaw, pRaw, keylenRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  const keylen = Number(keylenRaw);
  if (![N, r, p, keylen].every((value) => Number.isInteger(value) && value > 0)) return null;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return null;

  return { N, r, p, keylen, salt: Buffer.from(saltHex, "hex"), hash: hashHex };
}

export interface PasswordVerificationResult {
  valid: boolean;
  /** Zodra `true`: een geldig légacy-wachtwoord is gecontroleerd — de aanroeper moet de hash meteen herhashen naar het nieuwe scrypt-formaat. */
  needsRehash: boolean;
}

// Onafhankelijke review (WP83) wees uit dat scrypt (~45ms) versus de oude
// sha256 (~0.04ms) een goed meetbaar timingverschil introduceerde tussen
// "onbekende gebruikersnaam" (geen hash om tegen te controleren, dus geen
// berekening) en "bestaande gebruikersnaam, fout wachtwoord" (wél een volle
// scrypt-berekening) — precies het username-enumeratielek dat de generieke
// foutmelding in signInByCredentials (WP62) juist moet voorkomen. Deze vaste
// dummy-hash laat de aanroeper (auth.ts) bij een onbekende gebruikersnaam
// alsnog een even dure scrypt-berekening uitvoeren, puur om de responstijd
// gelijk te trekken — het resultaat wordt genegeerd, dit pad kan nooit
// "geldig" worden voor een echte login.
export const DUMMY_PASSWORD_HASH_FOR_TIMING = hashHouseholdPassword(
  "dit-wachtwoord-hoort-bij-geen-enkel-echt-huishouden"
);

/**
 * Controleert een wachtwoord tegen een opgeslagen hash, ongeacht of die nog
 * in het oude (legacy sha256) of nieuwe (scrypt) formaat staat.
 * `householdId` is alleen nog nodig voor de legacy-tak (dat oude formaat
 * gebruikte het als saltvervanger) — een nieuwe hash draagt zijn eigen salt
 * al bij zich en is dus nooit afhankelijk van het geheimhouden van
 * `householdId`.
 */
export function verifyHouseholdPassword(
  householdId: string,
  password: string,
  storedHash: string
): PasswordVerificationResult {
  if (isLegacyHashFormat(storedHash)) {
    const attempt = legacyHouseholdPasswordHash(householdId, password);
    const valid = timingSafeEqualHex(attempt, storedHash);
    return { valid, needsRehash: valid };
  }

  const parsed = parseScryptHash(storedHash);
  if (!parsed) return { valid: false, needsRehash: false };

  const derived = scryptDerive(password, parsed.salt, parsed);
  const valid = timingSafeEqualHex(derived.toString("hex"), parsed.hash);
  return { valid, needsRehash: false };
}

/** Geeft een leesbare foutmelding terug, of `null` als de vorm geldig is. */
export function validateCredentialsShape(username: string, password: string): string | null {
  if (normalizeUsername(username).length < 3) return "Kies een gebruikersnaam van minimaal 3 tekens.";
  if (password.length < 6) return "Kies een wachtwoord van minimaal 6 tekens.";
  return null;
}
