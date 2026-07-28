# Voortgang & overdrachtsdocument

Dit bestand is bedoeld voor een AI-coding-agent (Claude Code, Codex, of wie
dan ook) die dit project overneemt in een nieuwe sessie zonder chatgeschiedenis.
Lees eerst `AGENTS.md` (de oorspronkelijke productspecificatie),
`PRODUCT_VISION.md` (het actuele productkompas), `DATAMODEL_AUDIT.md`
(toetsing van schema/architectuur tegen de visie) en dan dit bestand voor de
actuele status en de manier van werken die tot nu toe is gevolgd.

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
- Bij acties binnen lange pagina's (zoals `/controle` en `/boodschappen`):
  redirect altijd terug naar dezelfde sectie of regel met query+hash
  (`?focus=...#...`) en open ingeklapte `<details>`-secties wanneer de
  gefocuste regel daarin staat. De gebruiker mag na een zoek/keuze-actie
  niet bovenaan de pagina belanden.

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
| WP10 | Persoonlijke gezinslogica | `Person.portionMultiplier`, `PersonPresenceOverride`, `src/domain/household/presence.ts` en bewerkbare gezinsleden op `/ons-gezin` — weekplanning filtert harde beperkingen per dag, boodschappenhoeveelheden schalen relatief op wie die dag mee-eet. |
| WP11 | Persoonsvoorkeuren per gerecht | Persoonlijke voorkeuren worden opgeslagen via bestaande `Preference(ownerType=PERSON, subjectType=RECIPE_VARIANT)` — op `/` kan per aanwezige eter favoriet/oké/liever niet/nooit worden gekozen; planning en `/gerechten` wegen dit per dag mee en sluiten persoonlijke `NEVER` uit. Geen nieuwe migratie nodig. |
| WP12 | Persoonsvoorkeuren per categorie/ingrediënt | De weekplanning kan per aanwezige eter nu ook voorkeuren voor receptcategorieën en ingrediënten vastleggen via dezelfde `Preference`-tabel. Planning en `/gerechten` wegen `RECIPE_CATEGORY` en `INGREDIENT` mee; persoonlijke `NEVER` sluit ook categorieën/ingrediënten uit. Geen nieuwe migratie nodig. |
| WP13 | Voorkeurenbeheer op Ons gezin | `/ons-gezin` toont nu een beheerblok voor alle persoonlijke voorkeuren per gezinslid, met leesbare labels voor gerecht/categorie/ingrediënt. Voorkeuren kunnen daar worden aangepast of verwijderd, met household-validatie in server actions. Geen nieuwe migratie nodig. |
| WP14 | Weekplanning opnieuw genereren | Op `/` staat een uitklapbare actie "Week opnieuw plannen". Deze verwijdert alleen de huidige weekplanning, bijbehorende boodschappenlijst en suggesties van het huidige huishouden, en bouwt de week opnieuw op met actuele voorkeuren. Geen nieuwe migratie nodig. |
| WP15 | Recepten/varianten beheren | Nieuwe pagina `/recepten` met navigatietab. Daar kan een recept met ingrediënten en eerste variant worden toegevoegd, kunnen titel/bron/categorie/status/eigenschappen/bereiding worden gecorrigeerd en kunnen varianten met context-signalen worden toegevoegd of bijgewerkt. Server actions valideren het huidige huishouden. Geen nieuwe migratie nodig. |
| WP16 | Ingrediëntenbeheer en receptingrediënten bewerken | `/recepten` heeft nu beheer voor ingrediënten: aanmaken, hernoemen, categorie/dieettags/voorraadcontrole aanpassen. Per bestaand recept kunnen ingrediëntregels en hoeveelheden worden vervangen; dubbele regels worden samengevoegd en de huidige boodschappenlijst wordt ongeldig gemaakt zodat nieuwe receptdata doorwerkt. Geen nieuwe migratie nodig. |
| WP17 | Productkeuzes per ingrediënt beheren | In `/recepten` kan per ingrediënt nu ook de productmatching worden beheerd: bekende producten bekijken, handmatig productkandidaten toevoegen, een standaardproduct vastleggen, producten uitsluiten of weer toestaan. Wijzigingen maken de huidige boodschappenlijst ongeldig zodat de volgende lijst de nieuwe standaardkeuze gebruikt. Geen nieuwe migratie nodig. |
| WP18 | Productvisie vastleggen | `PRODUCT_VISION.md` legt de aangescherpte richting vast: de app leert wat een huishouden eet en regelt boodschappen, met algemene slimme basis, huishouden-personalisatie, waarom-signalen, korte onboarding, expliciete bevestiging voor Picnic en beheer als secundaire route. Geen code- of migratiewijziging. |
| WP19 | Datamodel toetsen aan productvisie | `DATAMODEL_AUDIT.md` legt vast wat al goed staat en wat ontbreekt voor de zelflerende multi-household assistent: receptscope/eigenaarschap, typed tags, waarom-signalen, afgeleide patronen, rijkere onboarding, entry-context en provider-neutraliteit. Geen code- of migratiewijziging. |
| WP20 | Receptscope en basisdata scheiden | `Recipe.scope`, `householdId`, `originHouseholdId` en `promotedAt` scheiden globale basisrecepten van eigen huishoudrecepten. Seed-data blijft `GLOBAL`; nieuwe recepten op `/recepten` worden `HOUSEHOLD`; basisrecepten kunnen eerst naar een eigen kopie worden gekopieerd voordat ze bewerkt worden. Planning en gerechten tonen alleen globale/community-goedgekeurde recepten plus eigen huishoudrecepten. Migratie nodig: `20260727093000_recipe_scope`. |
| WP21 | Typed meal tags en slimme wens-invoer | `src/domain/meal-tags/mealTags.ts` introduceert een gecontroleerde taglaag boven bestaande categorieën/properties/contextFit, met herkenning van termen zoals AVG, snel, airfryer, kindvriendelijk, kip en sperziebonen. `/gerechten` heeft nu een wensveld ("AVG met sperziebonen en kip") dat suggesties filtert/rangschikt en kort uitlegt waarom iets past. De planner gebruikt dezelfde taglaag voor drukke dagen en kindvriendelijkheid. Geen nieuwe migratie nodig. |
| WP22 | Typed waarom-signalen bij vervangen | `FeedbackEvent.reason` en enum `FeedbackReason` leggen vast waarom een gebruiker een gerecht vervangt. `/gerechten` vraagt bij wisselen één korte reden, zoals "alleen nu iets anders", "niet lekker genoeg" of "te veel werk vandaag". `src/domain/learning/feedbackReasons.ts` zorgt dat redenen gecontroleerd blijven en dat bijvoorbeeld `TOO_MUCH_EFFORT` niet als smaakafkeur telt. Migratie nodig: `20260727104500_feedback_reasons`. |
| WP23 | Afgeleide patronen en leervragen | `LearnedPattern` en `LearningPrompt` leggen herhaalde gedragssignalen vast zonder meteen harde conclusies te trekken. Bij drie vervangingen van dezelfde receptcategorie op dezelfde dag ontstaat een pending leervraag. `/` toont maximaal twee slimme vragen tegelijk en antwoorden bevestigen of verwerpen het patroon. Migratie nodig: `20260727113000_learning_patterns`. |
| WP24 | Onboardingprofiel met snel/beter afstemmen | Onboarding heeft nu twee routes: `QUICK` voor snel starten en `DETAILED` voor meer afstemming. `Household.onboardingMode`, `planningStyle` en `maxSmartQuestionsPerSession` leggen het startprofiel vast. De planner gebruikt `planningStyle` als zachte score: veilig starten geeft bewezen/veilige gerechten voorrang, nieuwsgierig geeft nieuwe suggesties meer ruimte. Migratie nodig: `20260727133000_onboarding_profile`. |
| WP25 | Hoofdflow als assistent | `/` opent nu met een compacte assistentkaart die de eerstvolgende logische stap toont: leervraag beantwoorden, boodschappen voorbereiden, productkeuzes controleren of bevestigen. Weekstatistieken zijn compacter, leervragen gebruiken `maxSmartQuestionsPerSession`, en "Week opnieuw plannen" staat onder rustige meer-acties in plaats van bovenin als beheeractie. Geen nieuwe migratie nodig. |
| WP26 | Aanvullen en controle versimpelen | `/controle` toont nu eerst alleen uitzonderingen en onzekerheden; vertrouwde keuzes staan ingeklapt maar blijven bewerkbaar. `/boodschappen` toont vaste boodschappen en voorraadcheck als samenvattende uitklapsecties in plaats van grote open beheerblokken. Geen nieuwe migratie nodig. |
| WP27 | Directe knopfeedback op controle | Controle-acties gebruiken nu een client-side pending-knop (`PendingSubmitButton`) zodat klikken direct zichtbaar wordt met teksten zoals "Opslaan..." of "Kiezen...". Al opgeslagen/trusted producten tonen een groene "Opgeslagen"-status in plaats van opnieuw "Goed, onthouden", zodat de gebruiker ziet dat de keuze verwerkt is. Geen nieuwe migratie nodig. |
| WP28 | Echte product- en gerechtfoto's | `/controle` en `/boodschappen` verrijken bestaande productkeuzes automatisch met Picnic-afbeeldingen, prijs en verpakkingsinfo wanneer er een goede zoekmatch is, zonder het Picnic-id stilzwijgend als bevestigd product vast te leggen. Boodschappen tonen productminiaturen. Recepten hebben nu echte fotovelden (`imageUrl`, credit en bron), `/`, `/gerechten` en `/recepten` tonen alleen gekoppelde echte gerechtfoto's en geen nep-previewfoto's. Migratie nodig: `20260727162000_recipe_images`. |
| WP29 | Controle blijft op dezelfde plek | Acties op `/controle` redirecten nu terug naar dezelfde productregel via `?focus=<lineId>#line-<lineId>`, zodat zoeken of aanpassen midden op de pagina niet meer bovenaan uitkomt. Een gefocuste vertrouwde regel opent automatisch de ingeklapte sectie. Knoppen en de onderste navigatie hebben duidelijkere hover/focus/active feedback zodat selectie en klikken zichtbaar aanvoelen. Geen nieuwe migratie nodig. |
| WP30 | Vaste boodschappen zoeken en productkeuze sturen | Nieuwe vaste boodschappen worden niet meer uit een ingrediënt-dropdown gekozen: op `/boodschappen` kan de gebruiker live Picnic-producten zoeken (bv. "appels"), echte producten met foto/prijs/verpakking zien en een product als vaste boodschap kiezen. Die keuze maakt/hergebruikt een ingrediënt, voegt de vaste boodschap toe aan de huidige lijst en onthoudt het gekozen Picnic-product meteen als standaard voor dat ingrediënt. `/ons-gezin` heeft nu een productkeuze-instelling (`Gebalanceerd`, `Voordelig`, `Bekende verpakking`) die de automatische rangschikking stuurt wanneer er nog geen vertrouwde productkeuze is. Geen nieuwe migratie nodig; dit gebruikt `Household.deliveryPreference`. |
| WP31 | Navigatie en controle sneller maken | `/boodschappen` en `/controle` wachten niet meer op live Picnic-afbeeldingsverrijking tijdens paginaload; die draait via `after(...)` na de response. `/controle` haalt productkandidaten nu in één batch op in plaats van per regel apart. Er is een globale `loading.tsx` toegevoegd zodat routewissels meteen visuele feedback geven. Geen nieuwe migratie nodig. |
| WP32 | Vaste boodschappen wijzigen en klikfeedback | Vaste boodschappen op `/boodschappen` kunnen nu echt worden gewijzigd via dezelfde Picnic-zoekflow als toevoegen: de bestaande regel wordt vervangen, de standaard vaste boodschap wordt bijgewerkt en de pagina komt terug bij dezelfde regel. De boodschappenpagina maakt de Picnic-kopieerlijst uit de reeds opgehaalde regels in plaats van de lijst opnieuw op te vragen. De onderste navigatie toont direct een pending-status op de aangeklikte tab. Geen nieuwe migratie nodig. |
| WP33 | Performance quick wins zonder migratie | `/boodschappen` en `/controle` hergebruiken nu de shopping list die `ensureShoppingList` al ophaalt, in plaats van dezelfde lijst direct opnieuw te lezen. Picnic-fotoverrijking start alleen nog wanneer er daadwerkelijk producten zonder afbeelding zijn. `/controle` laadt standaard alleen productkandidaten voor aandacht-regels en een eventueel gefocuste vertrouwde regel. `/` hergebruikt het resultaat van `ensureMealPlan` en telt reviewregels met een lichte count-query. Geen nieuwe migratie nodig. |
| WP34 | Performance-indexen en product-upserts | Hot-path indexen toegevoegd voor reviewtellingen, vaste-regel lookups en feedbackgeschiedenis. `Product(ingredientId, externalRef)` is nu uniek, met een migratiestap die bestaande dubbele Picnic-producten eerst samenvoegt. Picnic-zoekresultaten worden nu met upserts opgeslagen in plaats van find-then-update/create. Migratie nodig: `20260727173500_performance_indexes`. |
| WP35 | Jouw week als assistent-flow | De homepage is vereenvoudigd: bovenaan staat de eerstvolgende assistentactie, direct daaronder een natuurlijke wens-invoer ("AVG met kip en sperziebonen") die naar passende gerechten leidt. Het weekmenu is scanbaarder gemaakt met duidelijke `Wissel`-acties per dag; uitleg en persoonlijke voorkeuren zitten rustig ingeklapt onder "Waarom dit?" en "Voorkeuren aanpassen". Geen nieuwe migratie nodig. |
| WP36 | Favorieten en productvoorkeuren aanpassen | `/ons-gezin` heeft nu zichtbare beheerblokken voor huishoudenvoorkeuren: maaltijdsoorten kunnen direct op `Favoriet`, `Oké`, `Liever niet` of `Geen voorkeur` worden gezet, en onthouden Picnic-productkeuzes kunnen per ingrediënt worden vergeten. Productkeuze-rangschikking blijft apart instelbaar. Geen nieuwe migratie nodig. |
| WP37 | Receptenpagina versimpeld | `/recepten` toont nu eerst een rustigere receptenbibliotheek: nieuw recept en receptenlijst komen vóór technisch ingrediënt/productbeheer, geavanceerd beheer staat onderaan ingeklapt en per recept zijn detailbewerking, ingrediënten en varianten ingeklapt. Geen nieuwe migratie nodig. |
| WP38 | Productkeuze en concrete maaltijdwens | `/controle` geeft na productacties een zichtbare statusmelding op dezelfde regel en vult bij regels met te weinig bekende keuzes automatisch live Picnic-alternatieven aan, met fallback als Picnic niet reageert. `/gerechten` kan een concrete wens met minimaal drie herkende ingrediënten (bijv. kip, rijst en paprika) direct als eigen huishouden-maaltijd plannen, terwijl bestaande recepten als alternatief zichtbaar blijven. Geen nieuwe migratie nodig. |
| WP39 | Maaltijdwens-parser aangescherpt | Concrete wensen zoals `kip rijst boontjes` kiezen nu één beste ingrediënt per genoemd product: algemene `kip` wordt standaard kipfilet in plaats van alle kipvarianten, `boontjes` wordt herkend als sperziebonen en specifieke woorden zoals `kipdijfilet` blijven specifiek. Tests dekken deze voorbeelden. Geen nieuwe migratie nodig. |
| WP40 | Bulk vaste boodschappen invoeren | `/boodschappen` heeft nu een plakveld voor vaste boodschappenlijsten. Regels of komma-gescheiden items zoals `2 pakken magere melk, drinkyoghurt framboos, bananen` worden gesplitst, per regel live bij Picnic gezocht en onder elkaar getoond met foto, prijs en verpakking. De gebruiker kan beste keuzes in één keer opslaan of per regel een alternatief kiezen; gekozen producten worden meteen als vaste boodschap en standaardproduct onthouden. Geen nieuwe migratie nodig. |
| WP41 | Bulk boodschappenlijst blijft staan | Als de gebruiker binnen de bulk vaste-boodschappen-preview één product los opslaat, blijft de originele geplakte lijst in beeld en wordt dezelfde preview opnieuw geopend. Daardoor kan de gebruiker de rest van de lijst verder afwerken zonder opnieuw te plakken of zoeken. Geen nieuwe migratie nodig. |
| WP42 | Bestellen in verpakkingen tonen | Vaste boodschappen gebruiken nieuwe productkeuzes voortaan als aantal verpakkingen (`1x pak melk`, `1x doos eieren`) in plaats van inhoudshoeveelheid (`1000 ml`, `10 stuks`). Bestaande vaste regels met bekende productverpakking worden in de UI omgerekend naar verpakkingen. De weeklijst toont bij receptproducten nu het aantal te bestellen verpakkingen (`4x aardappeltjes`) terwijl productnaam/verpakking zichtbaar blijft. Picnic-mandje gebruikt vaste `PIECE`-regels ook als pakket-aantal. Geen nieuwe migratie nodig. |
| WP43 | Per-dag boodschappencontrole | `/boodschappen` toont nu vóór de totaalbestelling een per-dag controleweergave: dag + gerecht, status compleet/controleren, producten met foto, verpakking, behoefte voor dat gerecht, totaal te bestellen verpakkingen en snelle links naar productcontrole of ander gerecht. De oude losse "Per maaltijd bekijken"-sectie is verwijderd zodat de route rustiger wordt. Geen nieuwe migratie nodig. |
| WP44 | Gekozen bulkregel verdwijnt | In de bulk vaste-boodschappen-preview verdwijnt een regel nu zodra de gebruiker daar een product voor opslaat. De originele lijst wordt automatisch zonder die regel opnieuw geopend, zodat alleen de nog te kiezen producten overblijven. Geen nieuwe migratie nodig. |
| WP45 | Dagcontrole met acties en kosten | `/boodschappen` toont per maaltijd nu een daginschatting van de kosten en per product de productkosten voor die maaltijd. Dagregels hebben directe acties voor weekaantal `+/-`, deze week verwijderen, huidige keuze opnieuw bevestigen, alleen deze week kiezen en product onthouden. Bekende alternatieven staan direct onder dezelfde dagregel en acties keren terug naar dezelfde plek met een zichtbare statusmelding. Geen nieuwe migratie nodig. |
| WP46 | Recept snel toevoegen | `/recepten` heeft nu bovenaan een snelle invoer met alleen receptnaam en een vrij tekstveld voor ingrediënten/hoeveelheden (`400g kipfilet`, `300 gram rijst`, `2 paprika`). De parser maakt of hergebruikt ingrediënten, combineert dubbele regels en zoekt bij gekoppelde Picnic-accounts automatisch productkandidaten met foto, prijs en verpakking zodat de boodschappencontrole daarna direct bruikbaar is. Het oude uitgebreide receptformulier staat onder geavanceerd. Geen nieuwe migratie nodig. |
| WP47 | Dagcontrole sluit beantwoorde keuzes | Op `/boodschappen` verdwijnt de huidige-product-keuzekaart zodra een product met `Onthouden` of `Alleen deze week` is bevestigd; alleen de statusmelding blijft staan. Productregels hebben naast `+/-` nu ook een direct invoerveld voor het aantal te bestellen verpakkingen/stuks, en de zichtbare bestelprijs rekent mee met het actuele weekaantal. Geen nieuwe migratie nodig. |
| WP48 | Zoeken overrulet gerecht-suggesties | `/gerechten` zoekt nu ook expliciet op recepttitel. Een zoekopdracht zoals `kofta` toont een eigen recept met die naam bovenaan, ook als er geen bekende tag of ingrediëntmatch is. Dieetrestricties en persoonlijke `nooit`-voorkeuren blijven wel harde filters. Geen nieuwe migratie nodig. |
| WP49 | Losse maaltijd per dag | Op `/` kan per dag nu een losse maaltijd worden ingevuld met naam en vrije productregels, bijvoorbeeld `Airfryeravond` met `Kai: frikandel` en `Ellen: mini kaassouffle`. Persoon-prefixen worden niet onderdeel van het ingrediënt, de app maakt/hergebruikt ingrediënten, zoekt bij gekoppelde Picnic-accounts productkandidaten en plant de losse maaltijd direct op die dag in. De boodschappenlijst wordt daarna opnieuw opgebouwd. Geen nieuwe migratie nodig. |
| WP50 | Maaltijdhoeveelheid versus weektotaal | `/boodschappen` toont in de per-dag controle nu het aantal verpakkingen en de kosten voor die specifieke maaltijd, bijvoorbeeld 800 g aardappelblokjes → 2x 750 g en 400 g boontjes → 1x 600 g. Het geaggregeerde weektotaal blijft apart beschikbaar onder "Weektotaal aanpassen", zodat dagcontrole en weekbestelling niet meer door elkaar lopen. Geen nieuwe migratie nodig. |
| WP51 | Vaste daggewoontes bovenop losse maaltijden | Nieuw `DayRoutine`-model: één expliciet onthouden daggewoonte per dag per huishouden. `ensureMealPlan` gebruikt een geldige gewoonte als voorstel voor die dag in plaats van de gewone scoring, maar valt terug op normale scoring zodra de gewoonte een harde beperking zou schenden. Op `/` staat per dag een "Onthoud voor elke [dag]" / "Stoppen"-toggle. Bijvangst: vaste boodschappen konden bij een actieve regel nog niet direct verwijderd worden (alleen via de omweg "deze week niet nodig" → "verwijder voorgoed"); dat kan nu rechtstreeks. Migratie nodig: `20260727180000_day_routines`. |
| WP52 | MealPlanEntry-context | `MealPlanEntry` uitgebreid met `source` (AUTO/MANUAL/ASSISTANT/REGENERATED), `status` (PROPOSED/ACCEPTED — `REPLACED` bewust nog niet in gebruik, vereist entry-geschiedenis), `reason`, `score`, `confidenceLevel`, `replacedFromRecipeVariantId`, gevuld op elk schrijfpunt (`ensureMealPlan`, handmatig wisselen, maaltijdwens, losse maaltijd). "Waarom dit?" op `/` gebruikt nu `entry.reason` rechtstreeks — handmatige wissels en losse maaltijden tonen daardoor nu ook een reden, wat voorheen leeg bleef. `getReasonsForPlan`/`MealSuggestion`-lookup is verwijderd. Migratie nodig (2 stappen): `20260727190000_meal_plan_entry_context`, `20260727190100_meal_plan_entry_updated_at_drop_default`. |
| UX WP1 | `/boodschappen` naar 1 samengevatte lijst | Gebruikersgevraagde kritische UX-review tegen `PRODUCT_VISION.md`: "Jullie boodschappenlijst" staat nu direct bovenaan als primaire, samengevatte weergave; de volledige per-dag uitsplitsing staat ongewijzigd maar standaard dicht in een uitklapper "Bekijk per dag". Paginahoogte in de standaardweergave met -72% (12.258px → 3.431px), zonder functieverlies. Geen nieuwe migratie nodig. |
| UX WP2 | Navigatie, titels, controle-teksten, startscherm compacter | Vervolg op de UX-review. Onderste navigatie gebruikt nu korte labels (`Lijst`, `Gezin`, …) met volledige tekst als `aria-label`, zodat labels niet meer afknippen. Recepttitels op `/` en `/gerechten` knippen niet meer af maar wrappen (`line-clamp-2`) naar twee regels. Productmatch-redenen op `/controle` zijn niet langer een letterlijke herhaling van de huishoudinstelling ("gebalanceerde productkeuze" op elke regel) maar leggen per product specifiek uit hoe het zich verhoudt tot de andere beschikbare opties (bijv. "Goedkoopste van 2 beschikbare opties"). Op `/` zijn de twee losse dagkaart-secties "Losse maaltijd invullen" en "Voorkeuren aanpassen" samengevoegd tot één uitklapper "Meer voor deze dag", zodat elke dag nog maar één actieblok toont in plaats van twee. Geen nieuwe migratie nodig. |
| Bugfix | Halve stuks op `/boodschappen` | Wanneer een product z'n `packageQuantity` onbekend is (alleen een vrije tekst-`packageSize`), viel de per-dag en weektotaal-weergave voor stuks-ingrediënten terug op de ruwe, door portieschaling soms gebroken receptbehoefte (bijv. "0.5x" bij 50% portie van een ingrediënt in stuks) — verwarrend, want dat oogt als een besteladvies terwijl je nooit een half stuk kunt bestellen. `formatQuantity` in `src/app/boodschappen/page.tsx` rondt stuks-hoeveelheden nu altijd naar boven af (`Math.ceil`), consistent met het "nooit afronden naar beneden"-principe van de verpakkingsengine. Losstaand gefixt: een pluralisatie-typefout "alternatiefven" (moest "alternatieven" zijn). Geen nieuwe migratie nodig. |
| Feature | Vangnet tegen stilzwijgend onder-bestellen | Een `ShoppingListLine` kan na het aanmaken handmatig verlaagd zijn (via "Weektotaal aanpassen") tot onder wat de geplande maaltijden deze week daadwerkelijk nodig hebben — de verpakkingsengine rondt altijd naar boven af, maar kan dat niet corrigeren als de behoefte zelf al te laag de berekening ingaat. `findShoppingListShortfalls` (`src/lib/shoppingList.ts`) telt de echte receptbehoefte per ingrediënt opnieuw op (gedeelde `aggregateMealNeeds`-helper, ook gebruikt door `ensureShoppingList`) en vergelijkt die met de huidige regel. Op `/boodschappen` toont een regel met een tekort nu expliciet "Dit is X g minder dan nodig..." met twee acties: "Aanvullen" (herberekent en zet de hoeveelheid recht) of "Toch doorgaan" (bewust accepteren, geen herhaalde melding tot de hoeveelheid weer handmatig wijzigt). Nieuw veld `ShoppingListLine.shortfallAcknowledged`. Migratie nodig: `20260728083705_shopping_list_line_shortfall`. |
| Bugfix | `/recepten`-wijzigingen leken te "reverten" | Root cause gevonden via live reproductie: server actions op `/recepten` (bijv. "Maak standaard" voor een productkeuze) sloegen wel correct op (geverifieerd in de database), maar riepen alleen `revalidatePath` aan zonder navigatie — de al open pagina bleef daardoor de oude data tonen totdat de gebruiker handmatig herlaadde. Dat voelde aan als "mijn keuze werd genegeerd", terwijl de data allang goed stond. Alle 13 server actions in `src/app/recepten/actions.ts` redirecten nu na een geslaagde opslag terug naar `/recepten?status=...`, wat een verse render afdwingt én een expliciete groene bevestiging toont ("Standaardproduct opgeslagen.", "Ingrediënten opgeslagen.", enz.) — dezelfde aanpak als het bestaande statusmeldingen-patroon op `/boodschappen`. Bijeffect: opengeklapte `<details>`-secties sluiten na het opslaan (geen gerichte heropen-op-dezelfde-plek zoals `/boodschappen` heeft — kan later worden toegevoegd). Geen nieuwe migratie nodig. |
| Feature | Bevestiging bij elke opslagactie (homepage + `/ons-gezin`) | Vervolg op de `/recepten`-fix: hetzelfde patroon (`revalidatePath` zonder redirect, dus geen zichtbare bevestiging) zat ook in `src/app/actions.ts` (8 functies, 0 redirects) en `src/app/ons-gezin/actions.ts` (11 functies, 1 redirect — alleen `logout`). Alle opslagacties op de homepage (`/`) en `/ons-gezin` redirecten nu terug naar dezelfde pagina met `?status=...` en tonen een expliciete groene bevestiging bovenaan ("Losse maaltijd ingepland.", "Onthouden als vaste gewoonte.", "Profiel opgeslagen.", "Toegangscode opgeslagen.", enz.) — dezelfde `redirectToHome`/`redirectToOnsGezin`-helpers als bij `/boodschappen` en `/recepten`. Geen nieuwe migratie nodig. |
| Feature | Recept verwijderen | `/recepten` had nergens een manier om een eigen recept te verwijderen. Nieuwe actie `deleteRecipe` (alleen voor eigen huishoudrecepten, nooit basisrecepten) blokkeert expliciet — met een leesbare melding, niet stilzwijgend — als het recept deze week nog op het menu staat of als vaste daggewoonte is ingesteld; anders worden bijbehorende (historische) `MealPlanEntry`/`MealSuggestion`-regels en het recept zelf in één transactie verwijderd. Bijvangst tijdens het testen: een geblokkeerde verwijdering toonde een generieke Next.js-crashpagina in plaats van de foutmelding, omdat `/recepten` geen `error.tsx` had — dat gold voor elke bestaande `throw new Error(...)` op deze pagina (bijv. ook de "titel bestaat al"-check), niet alleen voor deze nieuwe actie. Nieuwe `src/app/recepten/error.tsx` toont voortaan de eigen foutmelding netjes met een "Opnieuw proberen"-knop. Geen nieuwe migratie nodig. |
| Fix | Laatste opslagfeedback en algemene foutboundary | Codex-overname vanaf commit `7637057`: overgebleven `/boodschappen`-acties voor vaste boodschappen en voorraadstatus redirecten nu na succesvolle opslag terug naar de juiste sectie/regel met `?status=...`, openen de relevante `<details>` en tonen een groene bevestiging. De twee `/gerechten`-acties die een gerecht wisselen of een concrete maaltijdwens plannen redirecten nu naar `/` met een zichtbare statusmelding. Nieuwe `src/app/error.tsx` geeft alle routes zonder eigen error-boundary (o.a. `/`, `/gerechten`, `/boodschappen`, `/controle`, `/ons-gezin`) een nette "Dat lukte niet"-melding in plaats van de generieke crashervaring; `/recepten/error.tsx` blijft pagina-specifiek. Verificatie: `npm run lint` groen, `npx tsc --noEmit` groen na `npx prisma generate`, `npm run build` groen met netwerktoegang voor Google Fonts. `npm test` startte en 122/144 tests slaagden; de 22 failures waren allemaal integratietests met dezelfde lokale oorzaak: database `jurgen` bestaat niet op de lokale Postgres-server. Geen nieuwe migratie nodig. |
| WP53 | Leren van stil geaccepteerde weekplanning | Eerste toepassing van `MealPlanEntry.status` uit WP52: bij `confirmShoppingList` markeert `acceptProposedMealPlanEntries` alle nog-`PROPOSED` regels met source `AUTO`/`REGENERATED` als `ACCEPTED`, logt per regel een zachte impliciete `CHOSEN`-feedbackevent met context `source: "silent_week_acceptance"`, herberekent de variantconfidence en laat bestaande promotielogica voorzichtig meewegen. Handmatige en assistent-keuzes tellen hier niet dubbel mee, omdat die al expliciet gekozen zijn. De weekplanning gaat bij boodschappenbevestiging naar `GROCERIES_READY`, en `/boodschappen` toont een groene bevestiging dat het weekmenu als "goed genoeg" meetelt. Nieuwe pure helper + tests: `src/domain/meal-planning/silentAcceptance.ts`. Geen nieuwe migratie nodig. |
| WP54 | Leervragen uit herhaald stil accepteren | Stil geaccepteerde weekplanningen voeden nu voorzichtig dezelfde leerlaag als vervangingen: `recordRepeatedMealAcceptance` verhoogt per huishouden/categorie/dag een `MEAL_CATEGORY_ACCEPTED_ON_DAY`-patroon en maakt pas na 3 signalen een `CONFIRM_REPEATED_ACCEPTANCE`-leervraag. De homepage gebruikt nu antwoordopties per prompt, zodat acceptatievragen positieve opties tonen ("Vaker zo plannen", "Toeval") in plaats van alleen vervangingsredenen. Dit maakt WP53 bruikbaar zonder direct harde daggewoontes of voorkeuren te zetten. Migratie nodig: `20260728171000_silent_acceptance_learning`. |
| WP55 | Bevestigde acceptatiepatronen sturen planning zacht | De weekplanner leest nu bevestigde `MEAL_CATEGORY_ACCEPTED_ON_DAY`-patronen met `confirmedReason=ALWAYS_USE` en geeft die categorie op dezelfde dag een uitlegbare scorebonus ("past bij wat jullie vaker op dinsdag willen eten"). Dit is bewust een zachte bonus in `scoreMealPlanCandidate`, geen harde routine: persoonlijke `NEVER`-voorkeuren, dieetrestricties en vaste daggewoontes blijven winnen. Nieuwe scoringtests dekken zowel de bonus als het niet-overrulen van een persoonlijke nooit-voorkeur. Geen nieuwe migratie nodig. |
| WP56 | Geleerde weekpatronen beheren | `/ons-gezin` toont nu een compact uitklapblok "Wat ik over jullie week heb geleerd" met echte `LearnedPattern`-regels: type patroon, dag/categorie, status, aantal signalen, zekerheid en eventuele bevestigde reden. Per patroon kan de gebruiker het patroon vergeten; daarbij worden open leervragen voor dat patroon ook dismissed en redirect de pagina terug met een groene bevestiging. Geen nieuwe migratie nodig. |
| WP57 | Daggerichte gerechtvoorkeuren | Nieuw beheerblok `DayRecipePreferencesManager` op `/ons-gezin`: per gerecht kan het huishouden aangeven of het "vaak", "soms" of "liever niet" op een specifieke dag past. Hergebruikt bewust de bestaande `Preference`-tabel (`ownerType=HOUSEHOLD`, samengestelde `ownerId` via `dayRecipePreferenceOwnerId(householdId, dayKey)`, `subjectType=RECIPE_VARIANT`) — geen nieuw model, geen nieuwe migratie. `scoreMealPlanCandidate` geeft een uitlegbare scorebonus/-malus per stance ("staat in jullie vaste opties voor dinsdag" / "kiezen jullie minder graag op dinsdag"), en `/gerechten` kan nu ook op deze dagopties filteren, met een link vanaf het weekmenu die het filter direct opent. |

## Nog te doen (roadmap, nog niet gestart)

- **Nieuwe hoofdflow is leidend:** `Week kiezen → Aanvullen → Per dag controleren → Totaalbestelling controleren → Naar Picnic`.
- De expliciete prioriteitenlijst uit `DATAMODEL_AUDIT.md` (punten 1 t/m 6: receptscope, typed tags, waarom-signalen, afgeleide patronen, onboardingprofiel, entry-context) is nu volledig afgerond (WP20–WP23, WP52).
- De recente "bevestiging bij elke opslagactie"-sweep is afgerond voor de bekende losse acties op `/`, `/gerechten`, `/recepten`, `/ons-gezin` en `/boodschappen`. Bij nieuwe server actions dezelfde regel blijven volgen: na succesvolle mutatie redirecten naar een verse render met `?status=...` en, op lange pagina's, terug naar dezelfde sectie/regel.
- WP56 maakt geleerde weekpatronen zichtbaar en beheerbaar op `/ons-gezin`; WP57 voegt daar daggerichte gerechtvoorkeuren aan toe (los van de automatisch geleerde patronen — dit zijn expliciete, door de gebruiker gezette voorkeuren). Logisch vervolg: betere uitleg/undo rond leerpatronen, of provider-neutraliteit/voorraad uit `DATAMODEL_AUDIT.md` punt 7/8.
- Nog open in `DATAMODEL_AUDIT.md`, lagere prioriteit, nog niet gepland: punt 7 (provider-neutraliteit — `Product.externalRef` is feitelijk Picnic-specifiek; overweeg later `ProductExternalRef(provider, externalRef)`) en punt 8 (voorraad voelt nu permanent/administratief; productvisie wil een simpele wekelijkse voorraadcheck, mogelijk `InventoryCheckSession` later — vooral een UX-vraag, geen dringende datamodelwijziging).
- Verder geen vastgelegde "volgende WP" — kies in overleg met de gebruiker.
- **Let op voor de volgende sessie:** werk vanaf hier verder op `main`/een nieuwe branch vanaf `main` — zowel Claude- als Codex-sessies hebben recent rechtstreeks tegen dit project gewerkt (zie de WP53–WP57-commits), dus neem niet aan dat de laatst bekende branch-staat uit een eerdere sessie nog actueel is. Controleer altijd eerst `git log origin/main` en dit bestand voordat je verder bouwt.

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
