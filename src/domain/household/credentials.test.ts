import { test } from "node:test";
import assert from "node:assert/strict";
import { hashHouseholdPassword, normalizeUsername, validateCredentialsShape } from "./credentials";

test("hashHouseholdPassword: hetzelfde wachtwoord geeft bij twee verschillende huishoudens nooit dezelfde hash", () => {
  const hashA = hashHouseholdPassword("household-a", "geheimwachtwoord");
  const hashB = hashHouseholdPassword("household-b", "geheimwachtwoord");
  assert.notEqual(hashA, hashB, "een wachtwoordhash mag nooit hergebruikt kunnen worden voor een ander huishouden");
});

test("hashHouseholdPassword: wachtwoord is hoofdlettergevoelig", () => {
  const hashLower = hashHouseholdPassword("household-a", "geheimwachtwoord");
  const hashUpper = hashHouseholdPassword("household-a", "GEHEIMWACHTWOORD");
  assert.notEqual(hashLower, hashUpper);
});

test("hashHouseholdPassword: hetzelfde wachtwoord bij hetzelfde huishouden geeft dezelfde hash", () => {
  const hash1 = hashHouseholdPassword("household-a", "geheimwachtwoord");
  const hash2 = hashHouseholdPassword("household-a", "geheimwachtwoord");
  assert.equal(hash1, hash2);
});

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
