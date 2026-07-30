# Werkregels voor een AI-coding-agent op dit project

Dit bestand wordt automatisch geladen (via `CLAUDE.md`) bij elke sessie op
dit project — in tegenstelling tot `PROGRESS.md` en `OPERATIONS.md`, die je
apart moet lezen. Zet hier daarom alleen de regels die je **elke keer**
moet kennen, niet de volledige geschiedenis of diepgaande troubleshooting
(dat hoort in `PROGRESS.md` respectievelijk `OPERATIONS.md`).

## Manier van werken

- **Werk per work package (WP)**, niet alles in één keer. Na elk work
  package: rapporteer kort wat er is gebouwd en wat de gebruiker live zou
  moeten zien, en wacht op een expliciete bevestiging ("ga door", "graag
  verder", etc.) voordat je aan het volgende begint.
- **Standaardgedrag (sinds WP7, expliciet zo gewenst door de gebruiker):**
  zodra een work package klaar en getest is (zie de Definition of Done
  hieronder), maak een pull request aan en **merge die meteen naar `main`
  zonder daar apart om toestemming te vragen** — dat leverde alleen
  verwarring op. Rapporteer na afloop gewoon wat er is gemerged en wat de
  gebruiker live zou moeten zien.
- **Vraag nog wél altijd expliciet toestemming voordat je:**
  - iets naar productie (Vercel/Supabase) migreert — dit *kan* trouwens
    sowieso niet automatisch: de sandbox-omgeving heeft geen netwerktoegang
    tot de Supabase-database, dus eenmalige/handmatige productie-acties
    moeten altijd door de gebruiker zelf op hun eigen machine of in hun
    eigen Vercel/Supabase-dashboard gebeuren (zie `OPERATIONS.md`);
  - een destructieve git-actie uitvoert (force-push, `reset --hard`, etc.).
- Ontwikkel op branch **`claude/family-assistant-rebuild-fw4fav`**. Na een
  merge naar `main`: reset deze branch naar de nieuwe `main`
  (`git fetch origin main && git checkout -B claude/family-assistant-rebuild-fw4fav origin/main && git push`)
  zodat het volgende work package op een schone basis begint.
- Commit-berichten en PR's zijn in het Nederlands geschreven, consistent met
  de rest van het project (`AGENTS.md`, UI-teksten).
- Bij acties binnen lange pagina's (zoals `/controle` en `/boodschappen`):
  redirect altijd terug naar dezelfde sectie of regel met query+hash
  (`?focus=...#...`) en open ingeklapte `<details>`-secties wanneer de
  gefocuste regel daarin staat. De gebruiker mag na een zoek/keuze-actie
  niet bovenaan de pagina belanden.

## Definition of Done per work package

Een work package is pas klaar als **alles** hieronder klopt — niet alleen
"het compileert". Dit is dezelfde checklist die impliciet bij elk eerder
work package in `PROGRESS.md` is toegepast, nu expliciet vastgelegd zodat
een nieuwe sessie 'm niet zelf hoeft te reconstrueren.

1. **Uitgelegd voordat je begon**: bij een wijziging die meerdere bestanden
   of een schemawijziging raakt, is er eerst kort benoemd wat er gaat
   veranderen, welke bestanden geraakt worden en wat de risico's zijn (zie
   ook `AGENTS.md`, "Werk in kleine stappen").
2. **`npm run verify` slaagt volledig** — dit draait lint, typecheck, de
   unit-/integratietests en de build in één keer. Los draaien
   (`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`) mag
   ook, maar `verify` is de kortste weg om niets te vergeten.
3. **`npm run test:e2e` draait** wanneer de wijziging een gebruikersstroom
   raakt die de kritieke flow doorkruist (inloggen/onboarding, weekmenu,
   boodschappen, Picnic-mandje) — niet nodig voor een geïsoleerde
   backend-only wijziging zonder UI-impact.
4. **Geen regressie**: bestaande functionaliteit is niet stilzwijgend
   veranderd of kapotgemaakt (zie `AGENTS.md`, "Houd de app werkend").
5. **Geen schijnfunctionaliteit**: geen knop of tekst die meer belooft dan
   er werkelijk gebeurt (zie `AGENTS.md`, "Geen schijnfunctionaliteit").
6. **Bij een schemawijziging**: een migratie aangemaakt volgens de
   sandbox-workflow in `OPERATIONS.md`, lokaal toegepast en geverifieerd
   (geen onverwachte drift).
7. **Samengevat wat is veranderd**, inclusief: welke bestanden, welke
   nieuwe migratie (indien van toepassing), en of er een eenmalige actie
   van de gebruiker nodig is (bijv. een Vercel-environment-variable) — in
   dat laatste geval expliciet vragen/aankondigen, niet aannemen dat de
   gebruiker dat zelf wel vindt.
8. **`PROGRESS.md` bijgewerkt** met een nieuwe rij die kort beschrijft wat
   er gebouwd is, wat er getest is, en of er een migratie nodig was.

Wanneer een van deze punten niet haalbaar is binnen de huidige sandbox
(bijvoorbeeld: een productiemigratie kan hier nooit zelf gedraaid worden),
meld dat expliciet in plaats van te doen alsof het wel geverifieerd is.

## Wanneer geen aannames doen

- Bij harde beperkingen/allergieën van gezinsleden — nooit als gewone
  negatieve voorkeur behandelen (zie `PRODUCT_VISION.md`).
- Bij twijfelachtige productmatches — eerst laten controleren, nooit
  stilzwijgend kiezen (zie `PRODUCT_VISION.md`, `AGENTS.md` Fase 6).
- Bij elke wijziging aan authenticatie, sessiebeheer of household-isolatie
  (`src/lib/auth.ts` en aanverwante server actions) — dit raakt direct of
  de juiste gebruiker bij de juiste data komt. Verifieer expliciet met een
  scenario dat het beoogde gedrag bewijst, vertrouw niet op "het compileert
  en de happy path werkt".
- Bij een keuze die de productrichting wezenlijk raakt (zoals: individuele
  accounts versus gedeeld per huishouden) — vraag het de gebruiker in
  plaats van zelf te kiezen.
