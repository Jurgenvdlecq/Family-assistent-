# Meal planning — gap-analyse toekomstige productwensen

**Status**: analysedocument, geen implementatie. Onderdeel van de
SYSTEM_AUDIT.md-vervolgopdracht (Deel F). Beschrijft per productwens welke
bouwstenen er al zijn, wat ontbreekt, en welke *minimale* uitbreiding daarop
zou passen — zonder de bestaande weekplanner, scoringlogica,
boodschappenengine of Picnic-integratie te vervangen.

Volgorde in dit document = wensvolgorde uit de opdracht, niet een
prioriteits- of uitvoeringsvolgorde. Zie "Voorgestelde volgorde" onderaan
voor een aanbevolen, logische uitvoeringsvolgorde in kleine werkpakketten
(bewust zonder WP-nummers, zoals gevraagd).

Legenda "Datamodelwijziging nodig": **Nee** (bestaande velden volstaan),
**Klein** (één nieuw veld/model, analoog aan een bestaand patroon), **Ja**
(nieuw, niet-triviaal model of relatie).

---

## 1. Curated basiscollectie van echte gezinsmaaltijden

| | |
|---|---|
| **Bestaande bouwstenen** | `Recipe`/`RecipeVariant`/`RecipeIngredient` (39 GLOBAL-seedrecepten over 8 categorieën, zie `prisma/seed-data.ts`); `RecipeScope` (GLOBAL/HOUSEHOLD/COMMUNITY_*) onderscheidt al basisrecepten van eigen huishoudrecepten; `/recepten` heeft al een volledige CRUD-flow (`createRecipe`, `createQuickRecipe`, `copyRecipeToHousehold`). |
| **Ontbrekende functionaliteit** | De huidige 39 recepten zijn illustratief/gevarieerd, niet per se "wat dit gezin daadwerkelijk eet" — dat is inhoudelijk, geen technische beperking. |
| **Voorgestelde minimale uitbreiding** | Geen nieuwe code. Dit is een **contentvraag**: de product owner (samen met Ellen/Jurgen) loopt de 39 recepten door, verwijdert wat niet aansluit, en voegt eigen vaste gerechten toe via de al bestaande `/recepten`-flow of een seed-uitbreiding. Eventueel: een eenmalig script dat een lijst titel+ingrediënten omzet naar `createRecipe`-achtige inserts, als het invoertempo via de UI te traag is. |
| **Datamodelwijziging nodig?** | Nee. |
| **Risico's** | Geen technisch risico. Enige risico is tijdsinvestering van de product owner. |
| **Benodigde tests** | Geen nieuwe geautomatiseerde tests — bestaande recepten-tests (`createRecipe`, scope-checks) dekken de mechaniek al. |

## 2. Geen vis — als harde huishoudregel

| | |
|---|---|
| **Bestaande bouwstenen** | `src/lib/dietaryRestrictions.ts` kent het gecontroleerde vocabulaire al `"vis"` als `RestrictionTag`, en `Ingredient.category === "FISH"` wordt al meegenomen in `recipeConflictsWithRestrictions`. `Person.hardRestrictions` (JSON-array) wordt per aanwezig gezinslid samengevoegd tot `hardRestrictionsByDay` in `src/lib/household.ts` (`collectHardRestrictions`) en hard toegepast in `ensureMealPlan` (`src/lib/mealPlan.ts:263-268`) — dit is precies het mechanisme dat een allergie "nooit als gewone voorkeur" behandelt (AGENTS.md Fase 10). |
| **Ontbrekende functionaliteit** | Een harde regel is vandaag altijd aan een **persoon** gekoppeld (i.e. een allergie/dieetbeperking van een individu). Een gezinsbrede regel als "wij eten nooit vis" (geen allergie, een keuze) heeft geen natuurlijke plek — het zou nu alleen kunnen door de tag op elke persoon apart te zetten, wat semantisch verkeerd is (het oogt dan als een allergie van iedereen) en breekt zodra er een nieuw gezinslid bijkomt. |
| **Voorgestelde minimale uitbreiding** | Eén nieuw veld `Household.hardRestrictions: Json @default("[]")` — exact hetzelfde patroon en dezelfde tags als `Person.hardRestrictions`, alleen op huishoudniveau. `collectHardRestrictions` in `src/lib/household.ts` combineert dit veld simpelweg mee naast de per-persoon-lijst (union, geen aparte logica nodig — `recipeConflictsWithRestrictions` ziet toch alleen de samengevoegde tag-set). UI: één extra sectie op `/ons-gezin` naast de bestaande per-persoon-beperkingen, met dezelfde tekstinvoer + `resolveRestrictions`-validatie. |
| **Datamodelwijziging nodig?** | Klein — één JSON-veld, analoog aan een bestaand veld op een ander model. |
| **Risico's** | Laag. Enig aandachtspunt: goed documenteren dat dit veld semantisch "gezinsregel", niet "allergie van iedereen" betekent, zodat een toekomstige beheerder het niet per ongeluk gebruikt voor individuele beperkingen. |
| **Benodigde tests** | Unit test op `collectHardRestrictions`/`getHouseholdHardRestrictionsAndParticipantsByDay`: een huishoudregel sluit een recept uit ongeacht welke personen die dag aanwezig zijn (in tegenstelling tot een persoonsbeperking, die alleen telt als die persoon aanwezig is). Regressietest dat bestaande persoonsbeperkingen ongewijzigd blijven werken. |

## 3. Even/oneven-weekpatroon voor aanwezigheid

| | |
|---|---|
| **Bestaande bouwstenen** | `PersonPresenceOverride` (`personId`, `dayOfWeek`, `present`) — een **terugkerend wekelijks** patroon per persoon per weekdag, al gebruikt door `getPresentPersonsForDay`/`deriveParticipantsByDay` (`src/domain/household/presence.ts`, `src/lib/household.ts`). `Person.defaultPresent` als basiswaarde. |
| **Ontbrekende functionaliteit** | Geen concept van weekpariteit (even/oneven ISO-weeknummer) — `PersonPresenceOverride` is uniek per `(personId, dayOfWeek)`, dus kan maar één vaste waarde per weekdag opslaan, nooit "aanwezig in even weken, afwezig in oneven weken" (typisch co-ouderschap-/ploegendienstpatroon). |
| **Voorgestelde minimale uitbreiding** | `PersonPresenceOverride` uitbreiden met een optioneel `weekParity: WeekParity?` veld (`ALL \| EVEN \| ODD`, default `ALL` = huidig gedrag, dus 100% achterwaarts compatibel). Unique constraint wordt `(personId, dayOfWeek, weekParity)` zodat een persoon zowel een EVEN- als een ODD-regel voor dezelfde weekdag kan hebben. `getPresentPersonsForDay` (`presence.ts`) krijgt een extra parameter (de huidige week, al beschikbaar via `getCurrentWeekStart`/`weekStart`) en kiest bij het ophalen de meest specifieke regel (weekParity-match > ALL). |
| **Datamodelwijziging nodig?** | Klein — één nieuw optioneel veld + een samengestelde unique constraint, geen nieuw model. |
| **Risico's** | Middel: `getPresentPersonsForDay` wordt op meerdere plekken aangeroepen (`mealPlan.ts`, `/ons-gezin`, `/gerechten`) — elke aanroepplek moet de juiste week meegeven, anders val je stilzwijgend terug op het verkeerde patroon. Moet zorgvuldig gebeuren, geen big-bang. |
| **Benodigde tests** | Unit tests op `getPresentPersonsForDay` met een even- en een oneven-weekdatum voor dezelfde persoon/dag; regressietest dat een bestaande `ALL`-regel (huidige data, na migratie) exact hetzelfde gedrag blijft geven als vandaag. |

## 4. Vaste én wisselende weekdag-bezetting

| | |
|---|---|
| **Bestaande bouwstenen** | Grotendeels al aanwezig: `Person.defaultPresent` (vaste basis) + `PersonPresenceOverride` per weekdag (wisselend, terugkerend) dekken samen al "meestal aanwezig, behalve op vaste afwijkende dagen". `calculatePortionScaleByDay` (`presence.ts`) gebruikt dit al voor portiegrootte. |
| **Ontbrekende functionaliteit** | Een **eenmalige** afwijking voor één specifieke week ("deze week is Kai bij opa en oma, geen terugkerend patroon") kan nu niet apart van het vaste patroon worden vastgelegd — je zou het vaste patroon moeten aanpassen en achteraf weer terug moeten zetten. |
| **Voorgestelde minimale uitbreiding** | Zelfde uitbreiding als wens 3 kan dit gedeeltelijk meenemen, maar een echte eenmalige uitzondering is net iets anders (een datum, geen patroon). Kleinste losse uitbreiding: een `PersonPresenceOverride`-rij met een optioneel `specificWeekStart: DateTime? @db.Date` veld (naast `weekParity`) die, indien gezet, alleen die ene week geldt en voorrang krijgt boven het terugkerende patroon. Kan in dezelfde migratie als wens 3 meegenomen worden, of apart — functioneel onafhankelijk. |
| **Datamodelwijziging nodig?** | Klein — zelfde model, één extra optioneel veld. |
| **Risico's** | Laag, mits los getest van wens 3 (voorrangsvolgorde specifiek > weekParity > terugkerend `ALL` moet expliciet en getest zijn, anders ontstaat verwarring welke regel "wint"). |
| **Benodigde tests** | Unit test: een specifieke-week-uitzondering overschrijft zowel het terugkerende patroon als een eventuele weekParity-regel, alleen voor die ene week; de week erna geldt het normale patroon weer. |

## 5. Drie relevante suggesties per avond

| | |
|---|---|
| **Bestaande bouwstenen** | `chooseMealPlanCandidate` (`src/domain/meal-planning/scoreMealPlanCandidate.ts:308-316`) scoort **alle** kandidaten en sorteert ze al volledig — vandaag wordt alleen `[0]` (de winnaar) gebruikt. De scoring/uitleg-machinerie (`reasons`, `confidence`) werkt dus al per kandidaat, niet alleen voor de winnaar. `MealSuggestion`-model bestaat al (`householdId`, `recipeVariantId`, `reason`, `confidenceLevel`, `targetSlot`) maar wordt vandaag gebruikt om alleen de **gekozen** suggestie achteraf te loggen (voor `lastPlannedAt`-geschiedenis), niet als opslag van meerdere ongekozen alternatieven. |
| **Ontbrekende functionaliteit** | Geen opslag/UI voor "top 3 in plaats van top 1"; geen concept van een suggestie die nog een keuze vereist (`MealPlanEntryStatus` kent alleen `PROPOSED/ACCEPTED/REPLACED`, geen "wacht op gezamenlijke keuze uit opties"). |
| **Voorgestelde minimale uitbreiding** | (a) `chooseMealPlanCandidate` een variant laten teruggeven die de top-N (bv. 3) scored candidates teruggeeft in plaats van alleen de winnaar (kleine, pure functie-uitbreiding, geen scoringlogica wijzigt). (b) Deze 3 opslaan als `MealPlanEntryStatus = PROPOSED` blijft de winnaar; de overige 2 worden **niet** in `MealPlanEntry` geschreven (die heeft maar 1 rij per dag) maar in het bestaande `MealSuggestion`-model met `targetSlot` = die dag, zodat ze zichtbaar en doorzoekbaar zijn zonder een nieuw model. (c) UI op het startscherm: naast het voorgestelde gerecht per dag, een "2 andere opties"-uitklapper die dezelfde `replaceMealPlanEntry`-actie hergebruikt (die bestaat al, zie wens 6). |
| **Datamodelwijziging nodig?** | Nee, voor de basisversie (hergebruik `MealSuggestion`). Eventueel later een expliciet veld om "dit was een van de 3 getoonde opties" te onderscheiden van oudere/losse suggesties, maar niet noodzakelijk voor v1. |
| **Risico's** | Laag/middel — vooral UX-risico (niet te veel keuzestress toevoegen aan een scherm dat AGENTS.md juist rustig en met één hoofdactie wil houden, zie Fase 12). Moet zorgvuldig samen met wens 6 ontworpen worden. |
| **Benodigde tests** | Unit test op de top-N-variant van `chooseMealPlanCandidate` (determinisme, geen duplicaten, score-volgorde correct); regressietest dat de bestaande "kies automatisch de winnaar"-flow ongewijzigd blijft. |

## 6. Samen kiezen (Ellen en Jurgen)

| | |
|---|---|
| **Bestaande bouwstenen** | Eén gedeeld huishoud-account/sessie (bewuste productkeuze, zie AGENTS.md/OPERATIONS.md: "gedeeld huishoudwachtwoord, geen individuele accounts") — er is dus al maar één "keuzemoment" per huishouden, geen aparte identiteit per gebruiker binnen het huishouden om mee te stemmen. `replaceMealPlanEntry` (`src/app/gerechten/actions.ts:50`) is de bestaande actie om een voorgestelde maaltijd te vervangen, al household-scoped. |
| **Ontbrekende functionaliteit** | Er is geen concept van "twee mensen moeten het samen eens worden" — met één gedeelde sessie ziet de app sowieso maar één "gebruiker" per moment. Een asynchroon "voorstel + bevestiging door de ander"-mechanisme (denk: Ellen kiest overdag, Jurgen bevestigt 's avonds) bestaat niet. |
| **Voorgestelde minimale uitbreiding** | Gezien de expliciete productkeuze voor gedeelde huishoud-accounts (zie WORKFLOW.md: "een keuze die de productrichting wezenlijk raakt... vraag het de gebruiker") is dit punt **niet zomaar technisch op te lossen zonder een productbeslissing**: ofwel (a) blijft het simpel — wie er ook opent ziet dezelfde top-3 (wens 5) en kiest, "samen kiezen" gebeurt gewoon door er samen naar het scherm te kijken (geen code nodig), ofwel (b) er komt een lichte asynchrone laag: een `MealPlanEntry`-status als `AWAITING_CONFIRMATION` na een voorstel door "iemand", zichtbaar totdat een tweede keer bevestigd wordt. Optie (b) vereist een principekeuze (hoe onderscheid je "wie" binnen één gedeelde sessie?) die de product owner moet maken. |
| **Datamodelwijziging nodig?** | Nee voor optie (a). Voor optie (b): Klein (een extra status-waarde op `MealPlanEntryStatus`, geen nieuw model), maar de vraag "hoe identificeren we wie voorstelt/bevestigt zonder individuele accounts" is een open productvraag, geen technische. |
| **Risico's** | Optie (b) raakt de gedeeld-account-aanname direct — hoog risico op scope-kruip als dit niet eerst met de product owner is uitgeklaard. |
| **Benodigde tests** | Afhankelijk van gekozen optie; voor (b) minimaal: een voorstel dat pas na een tweede, expliciete bevestiging definitief wordt, en dat één bevestiging niet per ongeluk als twee telt. |
| **Open vraag voor de product owner** | Volstaat "samen naar hetzelfde scherm kijken" (optie a), of is een echt asynchroon voorstel/bevestig-mechanisme gewenst (optie b, vereist eerst een principekeuze over identiteit binnen het huishouden)? |

## 7. Aparte maaltijden voor kinderen versus volwassenen

| | |
|---|---|
| **Bestaande bouwstenen** | `PersonRole` (`PARENT/CHILD/OTHER`) al op `Person`; `VariantType` kent al `KID_FRIENDLY` als aparte receptvariant; `scoreMealPlanCandidate.ts` telt `KID_FRIENDLY`-tags al mee als positief signaal (`candidateTags.has("KID_FRIENDLY")`, regel 274-277); `RecipeVariant` ondersteunt al meerdere varianten per recept (FAST/FRESH/REHEATABLE/KID_FRIENDLY). |
| **Ontbrekende functionaliteit** | Vandaag is er **één** `MealPlanEntry` per dag voor het hele huishouden — geen concept van "twee verschillende gerechten op dezelfde dag" (één voor kinderen, één voor volwassenen). |
| **Voorgestelde minimale uitbreiding** | Dit is de meest ingrijpende wens in dit document. Kleinst mogelijke insteek: **niet** het datamodel meteen uitbreiden naar "N maaltijden per dag", maar eerst inzetten op de al bestaande `KID_FRIENDLY`-variant zelf beter te benutten (een enkel gerecht dat voor iedereen werkt, in een kindvriendelijke variant) — dat dekt een groot deel van de praktijk zonder schema-wijziging. Pas als dat structureel niet volstaat (het gezin wil écht twee volledig aparte gerechten dezelfde avond): `MealPlanEntry` unique constraint verruimen van `(mealPlanId, dayOfWeek)` naar `(mealPlanId, dayOfWeek, audience)` met een nieuwe `MealPlanEntryAudience`-enum (`HOUSEHOLD/CHILDREN/ADULTS`, default `HOUSEHOLD` = huidig gedrag). Dit raakt de boodschappenaggregatie (`ensureShoppingList`) die nu van "1 entry per dag" uitgaat — moet worden nagelopen of hoeveelheden per audience correct blijven optellen. |
| **Datamodelwijziging nodig?** | Ja, voor de volledige versie (nieuwe kolom + aangepaste unique constraint, en een audit van elke plek die "1 entry per dag" aanneemt — met name de boodschappenaggregatie). Nee voor de eerste, kleinere stap (KID_FRIENDLY-variant beter benutten). |
| **Risico's** | Hoog voor de volledige versie: raakt weekplanning, boodschappenaggregatie, feedback en UI tegelijk — expliciet in strijd met de scopebeperking "geen grote herbouw van de weekplanner/boodschappenengine" uit deze opdracht, dus zeker een apart, groter werkpakket met eigen akkoord vooraf. |
| **Benodigde tests** | Voor de volledige versie: aggregatietest dat twee entries op dezelfde dag (kind + volwassene) correct worden meegeteld in de boodschappenlijst zonder dubbeltelling of het missen van één van de twee. |
| **Open vraag voor de product owner** | Is "één kindvriendelijke variant van hetzelfde gerecht" voldoende, of moeten het echt twee volledig verschillende gerechten kunnen zijn op dezelfde avond? Dat bepaalt of dit een kleine of een grote wijziging wordt. |

## 8. Knorr Wereldgerechten / maaltijdpakketten

| | |
|---|---|
| **Bestaande bouwstenen** | `RecipeIngredient` (recept + ingrediënt + hoeveelheid) is al flexibel genoeg om een receptset zoals "Knorr Wereldgerecht Kip Tikka Masala + zelf toe te voegen kip/groente/rijst" te modelleren als een gewoon recept met een mix van een "pakket"-ingrediënt en losse verse ingrediënten. `Product`/`Ingredient` ondersteunen al merk (`Product.brand`) en verpakkingsgrootte. |
| **Ontbrekende functionaliteit** | Geen apart concept "maaltijdpakket" — zou vandaag gewoon als een normaal ingrediënt met merk "Knorr" gemodelleerd moeten worden, wat functioneel al werkt maar niet expliciet als zodanig herkenbaar is (bv. voor filtering "toon alleen pakketmaaltijden"). |
| **Voorgestelde minimale uitbreiding** | Geen schema-wijziging nodig: (a) een nieuw `Ingredient` per Knorr-pakket aanmaken (categorie bv. `PANTRY`/`OTHER`, naam "Knorr Wereldgerecht Tikka Masala"), gekoppeld aan een `Product` met merk "Knorr"; (b) het bestaande `Recipe.properties`-vrije-tekst-tagveld (al gebruikt voor "snel", "weekend", ...) uitbreiden met een tag als `"maaltijdpakket"` zodat dit soort recepten herkenbaar en filterbaar is zonder nieuw schema. |
| **Datamodelwijziging nodig?** | Nee — hergebruikt bestaande, generieke velden. |
| **Risico's** | Laag. Enige aandachtspunt: productmatching (`matchProduct.ts`) moet het samengestelde pakketproduct net zo betrouwbaar vinden als een los ingrediënt — geen aparte logica nodig, wel even expliciet controleren bij de eerste paar pakketrecepten. |
| **Benodigde tests** | Geen nieuwe testinfrastructuur nodig — een pakketrecept doorloopt gewoon de bestaande recept-/boodschappen-/matchingtests als extra testcase (bv. een integratietest die een pakketrecept door `ensureShoppingList` haalt). |

## 9. Samenstelbare aardappel-vlees-groente-maaltijden

| | |
|---|---|
| **Bestaande bouwstenen** | `RecipeIngredient`/`Ingredient.category` (bestaat al: MEAT/FISH/... — categorieën zijn uitbreidbaar); `Recipe.properties` vrije tags. |
| **Ontbrekende functionaliteit** | Geen concept van een "modulair" recept dat uit onafhankelijk kiesbare bouwstenen bestaat (kies zelf een aardappelbereiding + een vleessoort + een groente) — elk `Recipe` is vandaag een vaste, complete ingrediëntenlijst. |
| **Voorgestelde minimale uitbreiding** | Kleinste stap: dit **niet** als een nieuw datamodel bouwen, maar als een contentpatroon — meerdere kant-en-klare `Recipe`-varianten aanmaken die elk een concrete combinatie zijn (bv. "Gekookte aardappelen met kipfilet en sperziebonen", "Aardappelpuree met gehakt en wortel"), getagd met `properties: ["aardappel_vlees_groente"]`. Dat past bij de bestaande architectuur en levert meteen bruikbare, volledig doorgerekende boodschappenlijsten op (in tegenstelling tot een "kies zelf de losse bouwstenen"-UI, die de hele hoeveelheden-/verpakkingsengine (Fase 3) zou moeten aanpassen om drie onafhankelijke keuzes tegelijk te verwerken). Een echt samenstelbare (build-your-own) variant is een aparte, grotere wens — zie risico's. |
| **Datamodelwijziging nodig?** | Nee voor het contentpatroon. Ja (nieuw `RecipeTemplate`-achtig concept met losse componenten) voor een echt samenstelbare versie — niet aanbevolen als eerste stap. |
| **Risico's** | Een echte "kies zelf 3 losse bouwstenen"-versie raakt de quantity-/package-engine (AGENTS.md Fase 3, expliciet buiten scope van deze opdracht: "vervang de verpakkings-/hoeveelhedenengine niet") en is dus bewust niet de voorgestelde eerste stap. |
| **Benodigde tests** | Geen nieuwe voor het contentpatroon (bestaande recepttests volstaan). |

## 10. Normale maaltijden max. ongeveer eens per twee weken

| | |
|---|---|
| **Bestaande bouwstenen** | **Grotendeels al gebouwd.** `scoreMealPlanCandidate.ts:279-292`: als een recept minder dan 14 dagen geleden nog gepland stond, `-20` score en `hasDoubt`; na 35+ dagen juist een bonus. `lastPlannedByRecipeId` wordt gevuld vanuit `MealSuggestion`-geschiedenis (`mealPlan.ts:150-160, 302`). Dit is precies "maximaal ongeveer eens per 2 weken" als een *zacht* signaal, niet een harde blokkade. |
| **Ontbrekende functionaliteit** | Het is een score-penalty, geen harde uitsluiting — een recept met een sterke andere match (bv. favoriet van een gezinslid) kan de `-20` nog steeds overstemmen en toch binnen 14 dagen terugkomen. Als "ongeveer" letterlijk hard genoeg moet zijn, ontbreekt een harde ondergrens. |
| **Voorgestelde minimale uitbreiding** | Als het huidige zachte gedrag (in de praktijk al een sterke afremmer) volstaat: **geen wijziging nodig**, dit is al gebouwd. Als een hardere garantie gewenst is: de bestaande `-20`-penalty vervangen door een parametriseerbare drempel (bv. per categorie of globaal), of in `chooseMealPlanCandidate` kandidaten die binnen X dagen al gepland stonden expliciet uitsluiten in plaats van alleen afstraffen — een kleine aanpassing van bestaande, al goed geteste code, geen nieuwe architectuur. |
| **Datamodelwijziging nodig?** | Nee. |
| **Risico's** | Laag — wijzigt een bestaande, pure, al goed geteste functie. Wel opletten dat een hardere uitsluiting niet per ongeluk een week zonder geldige kandidaten oplevert bij een kleine receptencollectie. |
| **Benodigde tests** | Uitbreiding van de bestaande `scoreMealPlanCandidate.test.ts` met een scenario voor de nieuwe, striktere drempel (indien gekozen). |

## 11. Vast/voorkeurspatroon voor zondag

| | |
|---|---|
| **Bestaande bouwstenen** | `DayRoutine` (`householdId`, `dayOfWeek`, `recipeVariantId`) bestaat al specifiek voor dit doel (WP51: "een expliciet onthouden daggewoonte... ensureMealPlan gebruikt dit als voorstel voor die dag, maar nooit ten koste van een harde beperking", zie `mealPlan.ts:339-340`) én de UI/actie (`setDayRoutine`/`removeDayRoutine`, `src/app/actions.ts:411-434`) bestaat al. |
| **Ontbrekende functionaliteit** | Niets structureels — een vaste zondagsroutine ("elke zondag stamppot") kan vandaag al ingesteld worden via de bestaande daggewoonte-functionaliteit. Wat ontbreekt is hooguit een *voorkeurspatroon* in plaats van een *vaste* keuze (bv. "op zondag het liefst iets uit categorie X, maar niet elke week hetzelfde gerecht") — dat is net iets zachter dan wat `DayRoutine` vandaag doet (die legt één specifieke `recipeVariantId` vast). |
| **Voorgestelde minimale uitbreiding** | Voor een vaste keuze: niets bouwen, gewoon gebruiken wat er al is. Voor een zachter categorie-voorkeur-patroon: de bestaande `confirmedCategoryDayPatterns`/`LearnedPattern`-machinerie (`MEAL_CATEGORY_ACCEPTED_ON_DAY`, al ingelezen in `mealPlan.ts:167-176` en meegewogen in de score, regel 182-185) doet dit *automatisch* al zodra het gezin een paar keer consistent dezelfde categorie op zondag kiest — geen nieuwe code nodig, dit leert het systeem vanzelf uit gedrag (Fase 11-stijl). |
| **Datamodelwijziging nodig?** | Nee — beide varianten (hard via `DayRoutine`, zacht via geleerde patronen) bestaan al. |
| **Risico's** | Geen. |
| **Benodigde tests** | Geen nieuwe — bestaande tests voor `DayRoutine` en `LearnedPattern`/`confirmedCategoryDayPatterns` dekken dit al. |

## 12. Specialistische producten die niet via Picnic verkrijgbaar zijn

| | |
|---|---|
| **Bestaande bouwstenen** | `ProductProvider`-enum (vandaag alleen `PICNIC`); `MatchStatus` kent al `NOT_FOUND`/`UNAVAILABLE`; de controlepagina heeft al een "Niet gevonden"-sectie met "zonder product doorgaan" (AGENTS.md Fase 6, al gebouwd volgens `SYSTEM_AUDIT.md`); `addManualProduct` (`manualProductActions.ts`) voegt een eenmalig product toe, maar altijd nog gekoppeld aan een gevonden Picnic-`externalRef`/naam via zoeken — niet bedoeld voor iets dat principieel niet in Picnic te vinden is. |
| **Ontbrekende functionaliteit** | Geen manier om een boodschappenregel expliciet te markeren als "dit haal ik zelf ergens anders, hoef je niet in het Picnic-mandje te stoppen" — vandaag eindigt zo'n product altijd in de "niet gevonden"-sectie alsof het (nog) een openstaand probleem is, in plaats van een bewust "dit hoort niet bij Picnic"-besluit. |
| **Voorgestelde minimale uitbreiding** | Eén nieuwe `MatchStatus`-waarde, bv. `NOT_SOLD_HERE` (of het al bestaande `UNAVAILABLE` hergebruiken met een expliciete reden-tekst) die een regel blijvend uit de Picnic-mandje-transferstap houdt (`addToPicnicCart`/`transferredToPicnicAt`) maar wél op de lijst/het overzicht blijft staan als "zelf meenemen". Kleine toevoeging aan de controle-UI: een actie "wordt niet bij Picnic gehaald" naast de bestaande "zonder product doorgaan". |
| **Datamodelwijziging nodig?** | Nee (of Klein als een aparte enum-waarde de voorkeur heeft boven hergebruik van `UNAVAILABLE`). |
| **Risico's** | Laag — puur additief, raakt de bestaande Picnic-transferlogica alleen in de vorm van "sla deze regel over", een patroon dat al bestaat voor andere statussen. |
| **Benodigde tests** | Regressietest dat een regel met deze status nooit wordt meegenomen in `addToPicnicCart`/de bevestigingssamenvatting-totalen, maar wel zichtbaar blijft in de boodschappenlijst zelf. |

## 13. (Later) Weersinvloed op maaltijdsuggesties

| | |
|---|---|
| **Bestaande bouwstenen** | `scoreMealPlanCandidate.ts` heeft al een uitbreidbare signaalstructuur (`signal.score +=/-=`, met `reasons`) — een nieuw signaal toevoegen is qua vorm goedkoop. `busy`/`quiet` (weeklyRhythm) is het enige externe-context-signaal dat vandaag al meetelt. |
| **Ontbrekende functionaliteit** | Geen weerdata-bron, geen koppeling tussen weer en receptcategorie (bv. "warm weer → salade/AIRFRYER; koud weer → COMFORT_FOOD"). Expliciet als "later" gemarkeerd door de opdracht zelf — hier alleen ter volledigheid opgenomen. |
| **Voorgestelde minimale uitbreiding** | **Niet nu bouwen** (staat expliciet als "later" in de opdracht, en vereist een externe API-integratie — nieuwe dependency, nieuwe foutafhandeling, nieuwe environment-variabele — wat niet past bij de huidige scope). Wanneer dit ooit opgepakt wordt: eenmalige daginweerclassificatie (bv. "warm"/"koud"/"regen") als extra invoer aan `MealPlanScoringInput`, met een klein, expliciet signaal analoog aan `busy`. |
| **Datamodelwijziging nodig?** | Nee voor de scoring zelf (extra invoerparameter, geen opslag nodig); mogelijk een kleine cache-tabel als de weer-API niet te vaak aangeroepen mag worden — pas relevant bij daadwerkelijke bouw. |
| **Risico's** | Nieuwe externe dependency (weer-API), nieuwe foutafhandeling nodig (wat als de API niet bereikbaar is — mag nooit de hele planning blokkeren), kosten/rate-limits van een externe API. Reden waarom dit terecht als "later" is gemarkeerd. |
| **Benodigde tests** | N.v.t. voor nu. |

---

## Samenvattend overzicht

| # | Wens | Bouwstenen aanwezig | Omvang uitbreiding |
|---|---|---|---|
| 1 | Curated basiscollectie | Volledig | Geen code, content |
| 2 | Geen vis (huishoudregel) | Grotendeels | Klein |
| 3 | Even/oneven-weekpatroon | Deels | Klein |
| 4 | Vaste + wisselende bezetting | Grotendeels | Klein |
| 5 | 3 suggesties per avond | Grotendeels | Middel |
| 6 | Samen kiezen | Deels | Open productvraag eerst |
| 7 | Aparte kind/volwassen maaltijden | Deels | Groot (apart werkpakket) |
| 8 | Knorr/maaltijdpakketten | Volledig | Geen schema, content |
| 9 | Samenstelbare aardappel-vlees-groente | Deels | Klein (content) tot Groot (echt modulair) |
| 10 | Max. 1x/2 weken | Al grotendeels gebouwd | Geen tot Klein |
| 11 | Zondagspatroon | Al volledig gebouwd | Geen |
| 12 | Producten buiten Picnic | Grotendeels | Klein |
| 13 | Weersinvloed | Weinig | Later, niet nu |

## Voorgestelde uitvoeringsvolgorde (zonder WP-nummers)

Logisch geordend op: (a) al bijna gratis (hergebruikt bestaande bouwstenen),
(b) kleine, geïsoleerde uitbreidingen, (c) wensen die eerst een
productbeslissing van de product owner nodig hebben, (d) grote, aparte
werkpakketten met eigen akkoord vooraf.

1. **Zondagspatroon (11)** en **max. 1x/2 weken (10)** — controleren of het
   al gebouwde gedrag voldoet; zo niet, kleine parametertuning. Geen risico,
   direct te doen.
2. **Curated basiscollectie (1)** en **Knorr/pakketten (8)** — content-only,
   kan parallel aan elk ander punt.
3. **Geen vis als huishoudregel (2)** — kleine, geïsoleerde
   schemauitbreiding met hoge productwaarde (raakt allergieveiligheid-
   patroon, dus zorgvuldig maar klein).
4. **Producten buiten Picnic (12)** — kleine, geïsoleerde uitbreiding van de
   controlepagina.
5. **Aardappel-vlees-groente content (9, lichte variant)** — content-only,
   net als punt 2.
6. **Vaste + wisselende bezetting (4)** en **even/oneven-weekpatroon (3)** —
   samen op te pakken (zelfde model), gemiddeld risico door meerdere
   aanroepplekken van `getPresentPersonsForDay`.
7. **3 suggesties per avond (5)** — vereist eerst punt 6 idealiter niet,
   maar wel een expliciet UX-ontwerpgesprek (hoeveel keuzestress mag een
   scherm hebben, AGENTS.md Fase 12) voordat er gebouwd wordt.
8. **Samen kiezen (6)** — **eerst** een productbeslissing van de gebruiker
   nodig (zie open vraag hierboven) voordat dit gepland kan worden; kan pas
   na punt 7 zinvol ontworpen worden.
9. **Aparte kind/volwassen maaltijden (7)** — grootste wijziging, apart
   werkpakket, alleen oppakken na een expliciete scope-beslissing van de
   product owner (raakt weekplanning + boodschappenaggregatie tegelijk).
10. **Weersinvloed (13)** — bewust laatste, buiten scope tot expliciet
    gevraagd.
