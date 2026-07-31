import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  DUMMY_PASSWORD_HASH_FOR_TIMING,
  hashHouseholdPassword,
  normalizeUsername,
  validateCredentialsShape,
  verifyHouseholdPassword,
} from "./credentials";

// SYSTEM_AUDIT.md, bevinding 4: het oude formaat was sha256(householdId +
// ":" + password) — één snelle, ongesalte hash, altijd exact 64
// hex-tekens. Deze constante simuleert zo'n bestaande, nog niet
// gemigreerde hash uit een échte productiedatabase, zonder de oude
// hashfunctie zelf terug te hoeven bouwen in de tests.
const LEGACY_HOUSEHOLD_ID = "legacy-household-id";
const LEGACY_PASSWORD = "oudwachtwoord123";
function legacySha256(householdId: string, password: string): string {
  return crypto.createHash("sha256").update(`${householdId}:${password}`).digest("hex");
}
const LEGACY_HASH = legacySha256(LEGACY_HOUSEHOLD_ID, LEGACY_PASSWORD);

test("hashHouseholdPassword: nieuw wachtwoord wordt nooit meer als legacy sha256 opgeslagen", () => {
  const hash = hashHouseholdPassword("geheimwachtwoord");
  assert.match(hash, /^scrypt\$/, "een nieuwe hash moet met het scrypt-formaat beginnen");
  assert.doesNotMatch(hash, /^[0-9a-f]{64}$/i, "een nieuwe hash mag nooit toevallig op het oude 64-hex-tekens-formaat lijken");
});

test("hashHouseholdPassword: twee aanroepen met hetzelfde wachtwoord geven verschillende hashes (willekeurige salt)", () => {
  const hash1 = hashHouseholdPassword("hetzelfdewachtwoord");
  const hash2 = hashHouseholdPassword("hetzelfdewachtwoord");
  assert.notEqual(hash1, hash2, "elke hash moet zijn eigen, verse salt gebruiken — nooit twee keer dezelfde hash voor hetzelfde wachtwoord");
});

test("verifyHouseholdPassword (nieuw formaat): correct wachtwoord wordt geaccepteerd", () => {
  const hash = hashHouseholdPassword("correctwachtwoord");
  const result = verifyHouseholdPassword("household-a", "correctwachtwoord", hash);
  assert.equal(result.valid, true);
  assert.equal(result.needsRehash, false, "een al-nieuwe hash hoeft nooit opnieuw gehasht te worden");
});

test("verifyHouseholdPassword (nieuw formaat): fout wachtwoord wordt geweigerd", () => {
  const hash = hashHouseholdPassword("correctwachtwoord");
  const result = verifyHouseholdPassword("household-a", "verkeerdwachtwoord", hash);
  assert.equal(result.valid, false);
  assert.equal(result.needsRehash, false);
});

test("verifyHouseholdPassword (nieuw formaat): niet afhankelijk van householdId — de salt zit al in de hash", () => {
  const hash = hashHouseholdPassword("correctwachtwoord");
  const resultA = verifyHouseholdPassword("household-a", "correctwachtwoord", hash);
  const resultB = verifyHouseholdPassword("een-heel-ander-household-id", "correctwachtwoord", hash);
  assert.equal(resultA.valid, true);
  assert.equal(resultB.valid, true, "controle van een nieuwe hash mag nooit uitmaken welk householdId wordt meegegeven");
});

test("verifyHouseholdPassword (legacy): een bestaande, nog niet gemigreerde hash blijft één keer bruikbaar", () => {
  const result = verifyHouseholdPassword(LEGACY_HOUSEHOLD_ID, LEGACY_PASSWORD, LEGACY_HASH);
  assert.equal(result.valid, true, "een geldig legacy-wachtwoord moet nog steeds geaccepteerd worden");
  assert.equal(result.needsRehash, true, "een geslaagde legacy-controle moet aan de aanroeper signaleren dat er herhasht moet worden");
});

test("verifyHouseholdPassword (legacy): een foutieve legacy-login migreert niets", () => {
  const result = verifyHouseholdPassword(LEGACY_HOUSEHOLD_ID, "helemaalverkeerd", LEGACY_HASH);
  assert.equal(result.valid, false);
  assert.equal(result.needsRehash, false, "een mislukte poging mag nooit een herhash triggeren");
});

test("verifyHouseholdPassword: faalt veilig bij een onbekend of beschadigd hashformaat", () => {
  for (const broken of ["", "onzin", "scrypt$niet-genoeg-delen", "scrypt$abc$8$1$64$saltjes$hashjes", "sha1$abc"]) {
    const result = verifyHouseholdPassword("household-a", "wachtwoord", broken);
    assert.equal(result.valid, false, `onherkenbaar formaat "${broken}" mag nooit als geldig worden beschouwd`);
    assert.equal(result.needsRehash, false);
  }
});

// Onafhankelijke review (WP83): scrypt is een stuk trager dan de oude
// sha256, wat een timingverschil introduceerde tussen "onbekende
// gebruikersnaam" (geen berekening) en "bestaande gebruikersnaam, fout
// wachtwoord" (wél een berekening) — een username-enumeratielek via
// responstijd. `signInByCredentials` (src/lib/auth.ts) rekent bij een
// onbekende gebruikersnaam nu ook een scrypt-verificatie uit tegen deze
// vaste dummy-hash, puur om even lang te duren. Hier alleen de
// functionele correctheid van die dummy-hash zelf getest — de timing zelf
// is niet betrouwbaar in een geautomatiseerde unit test te meten.
test("DUMMY_PASSWORD_HASH_FOR_TIMING: is een geldig scrypt-formaat en accepteert nooit een normaal wachtwoord", () => {
  assert.match(DUMMY_PASSWORD_HASH_FOR_TIMING, /^scrypt\$/, "moet hetzelfde formaat hebben als een echte hash, anders is de rekentijd niet gelijk");
  for (const attempt of ["wachtwoord123", "", "correctwachtwoord", "12345678"]) {
    const result = verifyHouseholdPassword("dummy-household-id-voor-timing", attempt, DUMMY_PASSWORD_HASH_FOR_TIMING);
    assert.equal(result.valid, false, `"${attempt}" mag nooit toevallig geldig zijn tegen de dummy-hash`);
  }
});

// signInByCredentials/setHouseholdCredentials zelf (src/lib/auth.ts) leunen
// op next/headers (cookies) en hebben dus geen live Next.js-requestcontext
// in een losse `tsx --test`-aanroep (zelfde beperking als elders in dit
// project, zie OPERATIONS.md "Testen") — de volledige login-/
// wachtwoordwijzigingsflow (inclusief de automatische herhash-transactie)
// is in plaats daarvan handmatig geverifieerd tegen een productiebuild, zie
// PROGRESS.md.

test("normalizeUsername: niet hoofdlettergevoelig en spaties worden genegeerd", () => {
  assert.equal(normalizeUsername("Jurgen"), "jurgen");
  assert.equal(normalizeUsername("  jurgen  "), "jurgen");
  assert.equal(normalizeUsername("JURGEN"), "jurgen");
});

test("validateCredentialsShape: te korte gebruikersnaam geeft een foutmelding", () => {
  assert.match(validateCredentialsShape("ab", "geldigwachtwoord") ?? "", /gebruikersnaam/i);
});

test("validateCredentialsShape: te kort wachtwoord geeft een foutmelding", () => {
  assert.match(validateCredentialsShape("geldigenaam", "kort") ?? "", /wachtwoord/i);
});

test("validateCredentialsShape: geldige combinatie geeft null terug", () => {
  assert.equal(validateCredentialsShape("jurgen", "geheimwachtwoord"), null);
});
