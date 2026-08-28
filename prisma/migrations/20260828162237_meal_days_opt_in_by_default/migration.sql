-- Correctie op de vorige migratie.
--
-- Die zette alle bestaande avonden op `included_in_groceries = true` om
-- "bestaande weken te laten doen wat ze deden". Dat botst met de hele reden
-- van de dagkeuze: de gebruiker opende de app, had niets aangevinkt, en zag
-- toch een volle lijst met weekmenu-producten. Bovendien waren die avonden
-- vaak niet eens zichtbaar in de dagkeuze (die begint bij het verwachte
-- bezorgmoment), dus er viel niets uit te vinken.
--
-- Avondeten is opt-in. Dus: alles uit, en de gebruiker tikt zelf aan.
UPDATE "meal_plan_entries" SET "included_in_groceries" = false;

-- De boodschappenlijsten die al gebouwd waren, bevatten nog de weekmenu-regels
-- van hierboven. Die worden niet vanzelf opnieuw opgebouwd (ensureShoppingList
-- geeft een bestaande lijst gewoon terug), dus die regels moeten hier weg.
--
-- Alleen regels die nog NIET naar het Picnic-mandje zijn overgedragen: een
-- overgedragen regel is de enige bron van waarheid voor "dit ligt al in het
-- echte mandje", en die markering weggooien zou betekenen dat een volgende
-- "Toevoegen aan Picnic-mandje" het product nog een keer bestelt.
--
-- Vaste boodschappen, zelf toegevoegde producten en voorraadaanvullingen
-- blijven staan — die hebben niets met de dagkeuze te maken.
DELETE FROM "shopping_list_lines"
WHERE "source" = 'MEAL'
  AND "transferred_to_picnic_at" IS NULL
  AND "shopping_list_id" IN (
    SELECT sl."id"
    FROM "shopping_lists" sl
    JOIN "meal_plans" mp ON mp."id" = sl."meal_plan_id"
    WHERE mp."week_start" >= date_trunc('week', CURRENT_DATE)
  );
