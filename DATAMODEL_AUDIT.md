# Datamodel Audit Tegen Product Vision

Datum: 2026-07-27  
Scope: toetsing van het huidige Prisma-schema en de belangrijkste domeinlogica
tegen `PRODUCT_VISION.md`.

## Conclusie

De technische basis is sterk genoeg om op door te bouwen: multi-household,
personen, feedback-events, voorkeuren, productmatching, weekplanning en
boodschappenlijst zijn al aanwezig. De app is technisch duidelijk beter dan de
oude Picnic-besteller.

De grootste mismatch met de productvisie zit niet in de bestaande
fundamenten, maar in ontbrekende scheidingen:

1. globale basisdata versus huishouden-data;
2. gewone feedback versus waarom-signalen;
3. losse events versus afgeleide patronen;
4. receptbeheer versus assistentvoorstellen;
5. provider-neutrale boodschappenlijst versus Picnic-specifieke uitvoering.

Voor de volgende fase moeten we niet meer beheer toevoegen. Eerst moet het
model de leerambitie beter dragen.

## Wat Al Goed Staat

### Multi-household

Aanwezig:

- `Household`;
- `HouseholdSession`;
- `username` (uniek) + `passwordHash`;
- server actions met `assertCurrentHousehold`.

Beoordeling: goed fundament. De app kan meerdere huishoudens dragen.

Belangrijk aandachtspunt: globale tabellen zoals `Recipe`, `Ingredient` en
`Product` zijn nu niet gescheiden van huishouden-specifieke toevoegingen.

### Personen En Harde Beperkingen

Aanwezig:

- `Person`;
- `PersonPresenceOverride`;
- `portionMultiplier`;
- `hardRestrictions`;
- filtering via `getHouseholdHardRestrictions`;
- persoonlijke `NEVER`-voorkeuren op gerecht/categorie/ingredient.

Beoordeling: sterk genoeg voor de visie "huishouden-first, harde persoonlijke
blokkades winnen altijd".

Open punt: harde beperkingen staan als vrije JSON-array. Dat werkt nu, maar
voor brede adoptie is een gecontroleerd onboarding-/normalisatiepad nodig.

### Feedback En Voorkeuren

Aanwezig:

- `FeedbackEvent`;
- `Preference`;
- household en person ownership;
- `EXPLICIT` en `INFERRED`;
- confidence;
- scoring op gedrag en voorkeuren.

Beoordeling: goede eerste leerlaag.

Open punt: `FeedbackEvent.context` is te vrij voor het productdoel. Het is
handig als tijdelijke drager, maar niet genoeg voor typed waarom-signalen,
drie-keer-regel en patroonleren.

### Productmatching En Boodschappen

Aanwezig:

- `Product`;
- `HouseholdProductPreference`;
- `RejectedProductMatch`;
- `ShoppingList`;
- `ShoppingListLine`;
- `matchStatus`, `matchConfidence`, `matchReasons`;
- idempotente Picnic-transfer.

Beoordeling: sterk fundament. Vooral productvoorkeuren per huishouden zijn
goed gescheiden van globale productdata.

Open punt: de boodschappenlijst is grotendeels provider-neutraal, maar Picnic
zit nog zichtbaar in UI/actions en productvelden zoals `externalRef`.

## Belangrijkste Gaten

## 1. Recepten Hebben Geen Scope

Huidige situatie:

- `Recipe` is globaal.
- `Recipe.title` is uniek over alle huishoudens.
- Nieuwe recepten via `/recepten` worden dus in de globale ruimte gezet.
- Er is geen `householdId`, `visibility`, `sourceType` of promotiepad.

Waarom dit botst met de visie:

- Nieuwe recepten moeten standaard prive zijn.
- Globale basisrecepten moeten curated blijven.
- Community-recepten mogen pas na controle/promotie gedeeld worden.
- Een huishouden mag rare of persoonlijke recepten toevoegen zonder de basis
  voor andere gezinnen te vervuilen.

Aanbevolen modelrichting:

- `Recipe.scope`: `GLOBAL`, `HOUSEHOLD`, `COMMUNITY_CANDIDATE`, `COMMUNITY_APPROVED`
- `Recipe.householdId?`: eigenaar wanneer scope household/candidate is.
- `Recipe.createdByHouseholdId?` of `originHouseholdId?`.
- `Recipe.promotedAt?`, `Recipe.reviewStatus?` later optioneel.

Impact:

- Migratie nodig.
- Planning moet globale recepten plus eigen huishoudrecepten meenemen.
- Uniekheid van titel moet waarschijnlijk veranderen van globaal uniek naar
  scope/household-aware uniek.

Prioriteit: zeer hoog.

## 2. Tags En Context Zijn Te Vrij En Te Versnipperd

Huidige situatie:

- `Recipe.category` is een enum.
- `Recipe.properties` is `String[]`.
- `RecipeVariant.contextFit` is `String[]`.
- `VariantType` bevat een paar praktische labels.
- Oude app had nuttige menselijke tags: snel, maandag, AVG, airfryer,
  favoriet, niet-meer-tonen, veel eten.

Waarom dit botst met de visie:

- Slimme wens-invoer moet woorden als "AVG", "kip", "snel", "maandag",
  "airfryer" en "kindvriendelijk" betrouwbaar mappen.
- Vrije strings zijn handig, maar zonder gecontroleerde taglaag worden score,
  onboarding en assistentvragen rommelig.

Aanbevolen modelrichting:

- Introduceer gecontroleerde tags, bijvoorbeeld:
  - `MealTag`: `AVG`, `FAST`, `LOW_EFFORT`, `NORMAL`, `EXTENSIVE`,
    `KID_FRIENDLY`, `AIRFRYER`, `PASTA`, `RICE`, `WRAPS`, `WEEKEND`,
    `LEFTOVER_FRIENDLY`, `TRY_RECIPE`.
- Of begin zonder tabel met een typed enum en adapter rond bestaande
  `properties/contextFit`.

Impact:

- Kan in twee stappen:
  1. eerst domeinlaag die bestaande strings normaliseert naar tags;
  2. later migratie naar expliciete tagrelaties.

Prioriteit: hoog.

## 3. Waarom-Signalen Zijn Niet Typed

Huidige situatie:

- `FeedbackEvent.eventType` kent `CHOSEN`, `REPLACED`, `IGNORED`,
  `EXPLICIT_FEEDBACK`.
- De reden staat hooguit in vrije `context`.
- Er is geen onderscheid tussen "niet lekker", "te weinig tijd", "te vaak
  gehad", "alleen deze keer", "past niet bij wie mee-eet".

Waarom dit botst met de visie:

- De app moet leren waarom de gebruiker afwijkt.
- De drie-keer-regel heeft typed redenopties nodig.
- Smaak en context mogen niet door elkaar lopen.

Aanbevolen modelrichting:

- Voeg een typed redenlaag toe, bijvoorbeeld:
  - `FeedbackReason`: `NOT_TASTY`, `NO_APPETITE_NOW`, `TOO_MUCH_EFFORT`,
    `TOO_REPETITIVE`, `WRONG_DAY`, `WRONG_PARTICIPANTS`, `PRODUCT_WRONG`,
    `ONLY_THIS_TIME`, `ALWAYS_USE`, `NEVER_USE`, `COINCIDENCE`.
- Dit kan als enumveld op `FeedbackEvent` of als aparte `LearningSignal`.

Advies:

- Voor nieuwe leervragen liever aparte `LearningSignal` of uitbreiding van
  `FeedbackEvent`, niet alleen JSON.
- Houd `context` voor details, maar gebruik enumvelden voor scorelogica.

Prioriteit: zeer hoog.

## 4. Geen Afgeleide Patroonlaag

Huidige situatie:

- Scoring leest direct uit `Preference`, `FeedbackEvent`, recente suggesties
  en `weeklyRhythm`.
- Er is geen model voor "maandag is vaak snel", "AVG vaak met kip",
  "dit huishouden wil weinig variatie", "3 keer vervangen, vraag waarom".

Waarom dit botst met de visie:

- De app moet voorzichtig leren en vragen voordat hij conclusies trekt.
- Repeated behavior moet niet telkens opnieuw ad hoc berekend worden.
- Maximaal twee slimme vragen per sessie vraagt een queue/state voor
  openstaande leervragen.

Aanbevolen modelrichting:

- `LearnedPattern`
  - `householdId`
  - `personId?`
  - `patternType`
  - `subjectType?`
  - `subjectId?`
  - `context` JSON
  - `confidence`
  - `evidenceCount`
  - `status`: `CANDIDATE`, `CONFIRMED`, `DISMISSED`
  - `lastObservedAt`

- `LearningPrompt`
  - `householdId`
  - `promptType`
  - `trigger`
  - `payload`
  - `status`: `PENDING`, `ANSWERED`, `DISMISSED`
  - `createdAt`, `answeredAt`

Impact:

- Migratie nodig.
- Daarna kunnen drie-keer-regel en maximaal-twee-vragen-per-sessie netjes
  gebouwd worden.

Prioriteit: hoog.

## 5. Onboardingstatus Is Te Grof

Huidige situatie:

- `Household.onboardingStatus`: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`.
- Onboarding heeft één vaste route.
- Voorkeurscategorieen en weekritme worden direct gezet.

Waarom dit botst met de visie:

- Er moeten twee routes zijn: snel starten en beter afstemmen.
- Onboarding moet kunnen groeien: vaste boodschappen, avontuurlijkheid,
  variatie, gezondheid, productprovider, eerste voorbeeldweek.
- Niet alles hoeft in één completed-boolean.

Aanbevolen modelrichting:

- Voeg toe aan `Household` of aparte `HouseholdProfile`:
  - `onboardingMode`: `QUICK`, `DETAILED`;
  - `planningStyle`: `SAFE`, `BALANCED`, `ADVENTUROUS`;
  - `varietyPreference?`;
  - `healthPreference?`;
  - `newRecipePreference?`;
  - `maxSmartQuestionsPerSession` met default 2.

Advies:

- Een aparte `HouseholdProfile` houdt `Household` schoner.

Prioriteit: middel/hoog.

## 6. MealPlanEntry Mist Context Van Keuze

Huidige situatie:

- `MealPlanEntry` bewaart dag en variant.
- Reden staat in `MealSuggestion`, apart op `targetSlot`.
- Vervangingen loggen events, maar de entry zelf kent geen gekozen reden,
  chosenBy, accepted/changed status of user intent.

Waarom dit botst met de visie:

- Stilte is feedback: bevestigen zonder wijzigen moet herkenbaar zijn.
- Vervangen moet kunnen leiden tot waarom-vragen.
- Een weekmenu-entry moet later kunnen vertellen of hij door app, gebruiker
  of assistenttekst gekozen is.

Aanbevolen modelrichting:

- Breid `MealPlanEntry` uit met:
  - `source`: `AUTO`, `MANUAL`, `ASSISTANT`, `REGENERATED`;
  - `status`: `PROPOSED`, `ACCEPTED`, `REPLACED`;
  - `reason`;
  - `score`;
  - `confidenceLevel`;
  - `replacedFromRecipeVariantId?`;
  - `userIntent?` JSON of link naar intent/signal.

Impact:

- Migratie nodig.
- Kan deels later, maar helpt sterk voor leren en uitleg.

Prioriteit: hoog.

## 7. Provider-Neutraliteit Is Nog Niet Expliciet

Huidige situatie:

- Shopping list en line-model zijn redelijk provider-neutraal.
- `Product.externalRef` is generiek van naam, maar feitelijk Picnic-id.
- Picnic-acties zitten logisch in `src/lib/picnic` en app routes.

Waarom dit relevant is:

- Productvisie zegt: nu Picnic, later eventueel andere supermarkt of alleen
  lijst.

Aanbevolen modelrichting:

- Niet nu zwaar modelleren.
- Wel bij volgende productwerk:
  - noem provider expliciet bij external refs;
  - voorkom Picnic-velden in algemene planner/scoring;
  - overweeg later `ProductExternalRef(provider, externalRef)`.

Prioriteit: laag/middel.

## 8. Voorraad Is Nu Permanent, Visie Wil Simpele Weekervaring

Huidige situatie:

- `InventoryItem.status` blijft bewaard tussen weken.
- Oude app reset voorraad per week.
- Productvisie zegt: voorraad moet niet als administratie voelen.

Beoordeling:

- Technisch permanent bewaren is niet fout.
- UX moet waarschijnlijk wekelijks een simpele voorraadcheck tonen en
  permanente voorraadstatus minder prominent maken.

Aanbevolen richting:

- Geen directe datamodelwijziging nodig.
- Mogelijk later `InventoryCheckSession` of `ShoppingListInventoryAnswer` als
  we voorraad per week willen onderscheiden van permanente voorraad.

Prioriteit: middel, vooral UX.

## Prioriteiten Voor Volgende Work Packages

### WP20: Receptscope En Basisdata-Scheiding

Doel:

- globale basisrecepten scheiden van huishoudrecepten;
- nieuwe recepten standaard prive;
- planning gebruikt globale + eigen recepten;
- voorbereiding op community-promotie.

Waarschijnlijk migratie:

- `Recipe.scope`;
- `Recipe.householdId?`;
- aanpassing unieke index op titel.

### WP21: Typed Tags En Assistent-Wensbasis

Doel:

- gecontroleerde tags voor snel/normaal/uitgebreid/AVG/kindvriendelijk/etc.;
- adapter voor bestaande category/properties/contextFit;
- basis voor "AVG met kip en sperziebonen".

Kan starten zonder migratie, maar migratie is later waarschijnlijk beter.

### WP22: Waarom-Signalen En Drie-Keer-Regel

Doel:

- typed redenen bij vervanging/afwijzing;
- detectie van herhaald vervangen;
- queue voor maximaal twee slimme vragen per sessie.

Waarschijnlijk migratie:

- `FeedbackReason` enum of `LearningSignal`;
- `LearningPrompt`.

### WP23: Hoofdflow Terug Naar Assistent

Doel:

- compact startscherm;
- volgende stap;
- beheer uit hoofdroute;
- leervragen subtiel in flow.

Afhankelijkheid:

- kan deels parallel, maar wordt sterker na WP20-WP22.

## Geen Directe Blokkers

Deze dingen hoeven niet eerst:

- budget;
- aanbiedingen;
- andere supermarkten;
- publieke receptenmarktplaats;
- zware AI-receptgeneratie;
- automatisch bestellen.

## Besluit

Het huidige datamodel is goed als v1-fundament, maar nog niet scherp genoeg
voor de productvisie als zelflerende multi-household assistent. De volgende
bouwfase moet eerst de data-eigenaarschap- en leerlagen verbeteren. Daarna
kan de UX worden versimpeld zonder dat we later opnieuw onder de motorkap
moeten breken.
