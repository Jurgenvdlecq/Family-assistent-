# Operationele kennis

Deze dingen kostten tijd om uit te zoeken — lees dit voordat je ze opnieuw
ontdekt. In tegenstelling tot `WORKFLOW.md` wordt dit bestand **niet**
automatisch bij elke sessie geladen; open het gericht wanneer je tegen een
van onderstaande onderwerpen aanloopt (migraties, testen, architectuur,
beveiliging).

## Prisma-migraties in een niet-interactieve sandbox

`npx prisma migrate dev` werkt hier niet (vraagt om interactieve input).
Workflow die wel werkt:
1. `npx prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` → geeft de exacte SQL.
2. Maak handmatig een tijdgestempelde map onder `prisma/migrations/<timestamp>_<naam>/migration.sql` met die SQL.
3. `npx prisma migrate deploy` (lokale Postgres moet draaien: `sudo service postgresql start`).
4. Draai stap 1 nogmaals om te bevestigen dat er geen drift meer is (moet "empty migration" teruggeven).

Bekende, onschadelijke restdrift (sinds WP60 opgemerkt, niet veroorzaakt
door WP60 zelf): stap 4 blijft twee `RENAME INDEX`-regels teruggeven voor
`feedback_events`/`learned_patterns` — cosmetische naamgevingsdrift
(waarschijnlijk een eerdere Prisma-versiewissel die de truncatie/suffix-
conventie voor lange indexnamen wijzigde), functioneel identieke index,
geen data- of queryrisico. Bewust niet meegenomen in een niet-gerelateerde
migratie; los oppakken als het ooit hindert.

## Productie-migraties tegen Supabase

- De sandbox-omgeving kan geen rechtstreekse TCP-verbinding maken met de
  Supabase-database (netwerk-egress wordt geblokkeerd) — een migratie kan
  dus nooit vanuit deze werkomgeving zelf tegen productie gedraaid worden.
- Sinds **WP78** draait `prisma migrate deploy` automatisch als onderdeel van
  elke Vercel-deploy (`package.json`: `"build": "prisma migrate deploy && next
  build"`) — de gebruiker hoeft dus niet meer na elke merge zelf een
  migratie te draaien. Vereist wel één eenmalige, door de gebruiker zelf
  gezette Vercel-environment-variable, zie hieronder.
- Supabase heeft twee poolers:
  - **Transaction-mode pooler** (poort **6543**, `?pgbouncer=true`) — dit is
    de `DATABASE_URL` die de Next.js-app zelf gebruikt in Vercel (blijft
    ongewijzigd). Ondersteunt **geen** Prisma-migratielocking; `prisma
    migrate deploy` hangt hier oneindig.
  - **Session-mode pooler / directe verbinding** (poort **5432**, geen
    `pgbouncer`-parameter) — hiermee moet `prisma migrate deploy` draaien.
    `prisma.config.ts` gebruikt hiervoor `DIRECT_URL` (valt terug op
    `DATABASE_URL` als die niet gezet is, zoals lokaal).
- **Eenmalige actie voor de gebruiker in Vercel** (Project Settings →
  Environment Variables): een nieuwe variabele `DIRECT_URL` toevoegen met de
  session-pooler-connectiestring uit het Supabase-dashboard ("Connect to
  your project" → Session pooler):
  ```
  DIRECT_URL="postgresql://postgres.<project-ref>:<wachtwoord>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
  ```
  Zonder deze variabele mislukt de eerstvolgende deploy in de build-stap
  (fail-closed: liever een mislukte deploy dan appcode live zetten die niet
  bij het databaseschema past). **Let op bij het invullen in Vercel**: de
  waarde moet **alleen** de kale connectiestring zijn — geen `DIRECT_URL=`
  ervoor en geen aanhalingstekens eromheen (dat gaf ooit `P1013: the scheme
  is not recognized`, opgelost door alleen de string vanaf `postgresql://`
  over te houden).
- Losstaand van elkaar geldig gebleven voor eenmalig handmatig gebruik
  (bijv. om een migratie te testen vóór een deploy): dezelfde
  sessie-pooler-string ook rechtstreeks meegeven aan een lokale
  `prisma migrate deploy`-aanroep:
  ```
  DIRECT_URL="postgresql://postgres.<project-ref>:<wachtwoord>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" npx prisma migrate deploy
  ```

## Testen

- `npm test` draait `tsx --test $(find src -name '*.test.ts')` — bewust geen
  extern testframework (Node's ingebouwde `node:test` + `node:assert/strict`).
- Zowel pure unit tests als integratietests tegen een **echte lokale
  Postgres** (geen Prisma-mocking) — zie `src/lib/inventory.test.ts` en
  `src/lib/picnic/cartService.test.ts` voor het gangbare patroon
  (fixture aanmaken → testen → opruimen in een `finally`-blok). Dit betekent
  dat `npm test` een draaiende lokale Postgres vereist (`sudo service
  postgresql start`) — zie `README.md` voor de basissetup.
- **Een aantal integratietests verwacht bovendien dat de database al
  geseed is** (`npm run db:seed`) — ze gaan uit van bestaande, gedeelde
  ingrediënten/recepten (bijv. "kipfilet") in plaats van hun eigen fixtures
  volledig zelf op te bouwen. Op een lokale ontwikkeldatabase merk je dit
  meestal niet (die is toch al geseed), maar een verse database — zoals in
  CI (`.github/workflows/ci.yml`) — moet expliciet `migrate deploy` én
  `db:seed` doorlopen vóórdat `npm test` draait, anders falen die tests met
  een `findUniqueOrThrow`-fout. Dit kostte een mislukte eerste CI-proefdraai
  (WP80) om te ontdekken.
- Voor UI-verificatie: Playwright met het voorgeïnstalleerde systeem-Chromium
  (`executablePath: "/opt/pw-browsers/chromium"`), altijd gecombineerd met
  een directe Prisma-query als bron van waarheid — niet blind op
  DOM/screenshot-timing vertrouwen.
- `npm run test:e2e` (WP59, Fase 15) draait de kritieke-flow-testsuite
  (`e2e/criticalFlow.e2e.ts`) tegen een eigen `next build && next start` op
  een losse poort, met een lokale mock-Picnic-server — nooit tegen een live
  Picnic-account. Bewust geen `next dev`: de dev-websocket bleek in deze
  sandbox onvoorspelbaar (zie `next.config.ts`/`devIndicators`-fix). Duurt
  ca. 25-60s, vooral de eigen `next build`-stap; niet in de gewone
  `npm test`-run opgenomen.
- Vóór het starten van een lokale productiebuild/-server (bijv. voor
  handmatige Playwright-verificatie op poort 3199): controleer altijd eerst
  op een leftover `next-server`-proces van een eerdere run
  (`ps aux | grep next-server`) en kill het — anders serveert de "nieuwe"
  server soms stilletjes een oude build.

## Architectuur

- Domain-driven, incrementele migratie: nieuwe domeinlogica komt onder
  `src/domain/<naam>/` (`household`, `attention`, `learning`,
  `meal-planning`, `meal-tags`, `product-matching`), naast de bestaande
  `src/lib/`. Geen big-bang herschrijving — `PROJECT_BLUEPRINT.md`'s Fase 1
  beschrijft een verdergaande doelstructuur (`application/`,
  `infrastructure/`), maar die is nog niet volledig doorgevoerd; neem de
  daadwerkelijke `src/`-mappen als waarheid, niet de Fase 1-tekst alleen.
- Server Components + Server Actions (`"use server"`) zijn de enige manier
  om te muteren; `revalidatePath` voor cache-invalidatie.
- Consistent principe door het hele project: **nooit stilzwijgend een
  aanname doen** bij onzekerheid — onbekende dieetrestrictie-tekst,
  onbekende pakketgrootte, onbekende voorraadstatus worden allemaal expliciet
  gemaakt aan de gebruiker in plaats van geraden.
- Geen `Math.random()`-tiebreaks — altijd een deterministische, uitlegbare
  volgorde (zie WP5 `matchProduct.ts` als voorbeeld).
- Sinds WP9 komt het actuele huishouden uit `src/lib/auth.ts` via een
  HttpOnly-sessiecookie. Server actions mogen een `householdId` uit een form
  alleen gebruiken nadat `assertCurrentHousehold()` is aangeroepen, of moeten
  ownership afleiden via de betreffende shopping-list/line.
- Sinds WP77 loggen huishoudens in met een gebruikersnaam (uniek,
  genormaliseerd) + wachtwoord, niet meer met een gedeelde toegangscode.
  Bestaande productie-installaties met precies één huishouden zonder
  gebruikersnaam blijven tijdelijk werken via een legacy-pad
  (`getLegacySingleHousehold` in `src/lib/auth.ts`). Stel daarna bij
  `/ons-gezin` een gebruikersnaam + wachtwoord in zodat `/login` gebruikt
  kan worden.

## Beveiliging

- Er is ooit per ongeluk een GitHub Personal Access Token gedeeld in de chat
  in plaats van een `DATABASE_URL`. Als dat nog niet is gebeurd: de
  gebruiker is geadviseerd dat token te herroepen via GitHub Settings →
  Developer settings → Personal access tokens. Gebruik nooit een
  credential die niet expliciet voor het huidige doel is gegeven.
- Er is ook ooit een databasewachtwoord in platte tekst in de chat getypt
  (bij het invullen van een Vercel-environment-variable). Gebeurt dit
  opnieuw: adviseer de gebruiker het betreffende wachtwoord te roteren
  (Supabase → Project Settings → Database) en daarna zowel `DATABASE_URL`
  als `DIRECT_URL` in Vercel bij te werken, gevolgd door een redeploy.
