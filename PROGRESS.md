# Voortgang & overdrachtsdocument

Dit bestand is bedoeld voor een AI-coding-agent (Claude Code, Codex, of wie
dan ook) die dit project overneemt in een nieuwe sessie zonder chatgeschiedenis.
Lees eerst `AGENTS.md` (de volledige productspecificatie), en dan dit bestand
voor de actuele status en de manier van werken die tot nu toe is gevolgd.

## Manier van werken (belangrijk — hou dit aan)

- **Werk per work package (WP)**, niet alles in één keer. Na elk work
  package: rapporteer kort wat er is gebouwd en wat de gebruiker live zou
  moeten zien, en wacht op een expliciete bevestiging ("ga door", "graag
  verder", etc.) voordat je aan het volgende begint.
- **Standaardgedrag (sinds WP7, expliciet zo gewenst door de gebruiker):**
  zodra een work package klaar en getest is (tests/lint/typecheck/build
  slagen), maak een pull request aan en **merge die meteen naar `main`
  zonder daar apart om toestemming te vragen** — dat leverde alleen
  verwarring op. Rapporteer na afloop gewoon wat er is gemerged en wat de
  gebruiker live zou moeten zien.
- **Vraag nog wél altijd expliciet toestemming voordat je:**
  - iets naar productie (Vercel/Supabase) migreert — dit *kan* trouwens
    sowieso niet automatisch: de sandbox-omgeving heeft geen netwerktoegang
    tot de Supabase-database, dus productie-migraties moeten altijd door de
    gebruiker zelf op hun eigen machine gedraaid worden (zie hieronder),
  - een destructieve git-actie uitvoert (force-push, reset --hard, etc.).
- Ontwikkel op branch **`claude/family-assistant-rebuild-fw4fav`**. Na een
  merge naar `main`: reset deze branch naar de nieuwe `main`
  (`git fetch origin main && git checkout -B claude/family-assistant-rebuild-fw4fav origin/main && git push`)
  zodat het volgende work package op een schone basis begint.
- Commit-berichten en PR's zijn in het Nederlands geschreven, consistent met
  de rest van het project (`AGENTS.md`, UI-teksten).

## Status: work packages

Alle work packages hieronder zijn **gemerged in `main`** en staan live in
productie (Vercel + Supabase), tenzij anders vermeld.

| WP | Titel | Kern |
|----|-------|------|
| WP1 | Dieetbeperkingen | `src/lib/dietaryRestrictions.ts`, harde filtering in `ensureMealPlan` (`src/lib/mealPlan.ts`) — onbekende restrictie-tekst wordt nooit stilzwijgend genegeerd. |
| WP2 | Vaste boodschappen | `src/lib/fixedGroceries.ts`, sectie "Vaste boodschappen" op `/boodschappen`. |
| WP3 | Quantity-engine | `src/lib/quantity/*` — eenheden, verpakkingsberekening, voorraad-aftrek, tekstparser voor pakketgroottes. Pure, goed geteste module. |
| WP4 | Eenvoudig voorraadmodel | `InventoryItem`-model, `src/lib/inventory.ts`, sectie "Voorraadcontrole" op `/boodschappen`. Onbekende/lage voorraad wordt nooit als "genoeg" aangenomen. |
| WP5 | Productmatching als domein | `src/domain/product-matching/` (eerste map onder de doelarchitectuur `src/domain/`) — deterministische, uitlegbare matching, geen `Math.random()`. |
| WP6 | Controlepagina herbouwd | `/controle` in 3 secties (aandacht nodig / niet gevonden / vertrouwd), met verpakkingsberekening, hoeveelheid aanpassen, "alleen deze week", verwijderen. |
| WP7 | Picnic-mandje professionaliseren | `src/lib/picnic/cartService.ts` (idempotente add + clear), `PicnicNetworkError`/`PicnicApiError`, bevestigingsscherm vóór het vullen van het mandje (`src/lib/picnic/confirmationSummary.ts`), "mandje legen"-knop. |
| WP8 | Uitlegbare weekplanning-scoring | `src/domain/meal-planning/scoreMealPlanCandidate.ts` + `src/lib/mealPlan.ts` — `Math.random()` vervangen door deterministische score met stabiele tiebreak op variant-id, concrete redenen, recente-planning-signaal en variantvoorkeuren. |
| WP9 | Multi-household / authenticatie | `src/lib/auth.ts`, `/login`, `HouseholdSession` + toegangscode-hash — pagina's gebruiken het huidige huishouden uit een HttpOnly-sessiecookie en server actions valideren household-toegang voordat ze muteren. |

## Nog te doen (roadmap, nog niet gestart)

- **WP10 — Persoonlijke gezinslogica.** Volgende logische pakket uit Fase 10:
  aanwezigheid per dag, voorkeuren per persoon, portiegrootte/kind-volwassene
  en planningregels die deze signalen echt meewegen.

## Niet-voor-de-hand-liggende operationele kennis

Deze dingen kostten tijd om uit te zoeken — lees dit voordat je ze opnieuw
ontdekt.

### Prisma-migraties in een niet-interactieve sandbox

`npx prisma migrate dev` werkt hier niet (vraagt om interactieve input).
Workflow die wel werkt:
1. `npx prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` → geeft de exacte SQL.
2. Maak handmatig een tijdgestempelde map onder `prisma/migrations/<timestamp>_<naam>/migration.sql` met die SQL.
3. `npx prisma migrate deploy` (lokale Postgres moet draaien: `sudo service postgresql start`).
4. Draai stap 1 nogmaals om te bevestigen dat er geen drift meer is (moet "empty migration" teruggeven).

### Productie-migraties tegen Supabase

- De sandbox-omgeving kan geen rechtstreekse TCP-verbinding maken met de
  Supabase-database (netwerk-egress wordt geblokkeerd) — migraties tegen
  productie moeten **door de gebruiker zelf** gedraaid worden, vanaf hun
  eigen machine.
- Supabase heeft twee poolers:
  - **Transaction-mode pooler** (poort **6543**, `?pgbouncer=true`) — dit is
    de `DATABASE_URL` die de Next.js-app zelf gebruikt in Vercel. Ondersteunt
    **geen** Prisma-migratielocking; `prisma migrate deploy` hangt hier
    oneindig.
  - **Session-mode pooler / directe verbinding** (poort **5432**, geen
    `pgbouncer`-parameter) — hiermee moet `prisma migrate deploy` draaien.
- Instructie voor de gebruiker: haal de sessie-pooler-connectiestring op uit
  het Supabase-dashboard ("Connect to your project" → Session pooler), en
  draai lokaal:
  ```
  DATABASE_URL="postgresql://postgres.<project-ref>:<wachtwoord>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" npx prisma migrate deploy
  ```

### Testen

- `npm test` draait `tsx --test $(find src -name '*.test.ts')` — bewust geen
  extern testframework (Node's ingebouwde `node:test` + `node:assert/strict`).
- Zowel pure unit tests als integratietests tegen een **echte lokale
  Postgres** (geen Prisma-mocking) — zie `src/lib/inventory.test.ts` en
  `src/lib/picnic/cartService.test.ts` voor het gangbare patroon
  (fixture aanmaken → testen → opruimen in een `finally`-blok).
- Voor UI-verificatie: Playwright met het voorgeïnstalleerde systeem-Chromium
  (`executablePath: "/opt/pw-browsers/chromium"`), altijd gecombineerd met
  een directe Prisma-query als bron van waarheid — niet blind op
  DOM/screenshot-timing vertrouwen.

### Architectuur

- Domain-driven, incrementele migratie: nieuwe domeinlogica komt onder
  `src/domain/<naam>/` (tot nu toe alleen `product-matching`), naast de
  bestaande `src/lib/`. Geen big-bang herschrijving.
- Server Components + Server Actions (`"use server"`) zijn de enige manier
  om te muteren; `revalidatePath` voor cache-invalidatie.
- Consistent principe door het hele project: **nooit stilzwijgend een
  aanname doen** bij onzekerheid — onbekende dieetrestrictie-tekst,
  onbekende pakketgrootte, onbekende voorraadstatus worden allemaal expliciet
  gemaakt aan de gebruiker in plaats van geraden.
- Geen `Math.random()`-tiebreaks — altijd een deterministische, uitlegbare
  volgorde (zie WP5 `matchProduct.ts` als voorbeeld; WP8 moet hetzelfde doen
  voor `ensureMealPlan`).
- Sinds WP9 komt het actuele huishouden uit `src/lib/auth.ts` via een
  HttpOnly-sessiecookie. Server actions mogen een `householdId` uit een form
  alleen gebruiken nadat `assertCurrentHousehold()` is aangeroepen, of moeten
  ownership afleiden via de betreffende shopping-list/line.
- Bestaande productie-installaties met precies één huishouden zonder
  toegangscode blijven tijdelijk werken via een legacy-pad. Stel daarna bij
  `/ons-gezin` een toegangscode in zodat `/login` gebruikt kan worden.

### Beveiliging

- Er is ooit per ongeluk een GitHub Personal Access Token gedeeld in de chat
  in plaats van een `DATABASE_URL`. Als dat nog niet is gebeurd: de
  gebruiker is geadviseerd dat token te herroepen via GitHub Settings →
  Developer settings → Personal access tokens. Gebruik nooit een
  credential die niet expliciet voor het huidige doel is gegeven.
