# Family Assistant

Een zelflerende gezins- en boodschappenassistent: de app stelt een passend
weekmenu voor, laat je alleen corrigeren wat niet klopt, stelt automatisch
een boodschappenlijst samen en vult — pas na expliciete bevestiging — het
Picnic-mandje. Zie `PRODUCT_VISION.md` voor het volledige productkompas.

Gebouwd met Next.js (App Router, Server Components/Actions), TypeScript,
Prisma en PostgreSQL. Live op Vercel + Supabase.

## Documentatie — lees dit eerst

Dit project leunt zwaar op vastgelegde documentatie in plaats van
tribal knowledge. In deze volgorde:

1. **`AGENTS.md`** — de oorspronkelijke productspecificatie en het
   gefaseerde bouwplan.
2. **`PRODUCT_VISION.md`** — het actuele productkompas: kernbelofte,
   productprincipes, gebruikersstromen, bedrijfsregels.
3. **`DATAMODEL_AUDIT.md`** — toetsing van het Prisma-schema tegen de
   productvisie, met openstaande aandachtspunten.
4. **`WORKFLOW.md`** — werkregels en Definition of Done voor elke
   wijziging (wordt automatisch geladen door Claude Code via `CLAUDE.md`).
5. **`OPERATIONS.md`** — operationele kennis die tijd kostte om uit te
   zoeken (Prisma-migraties, Supabase-poolers, testconventies).
6. **`PROGRESS.md`** — overdrachtsdocument met de volledige geschiedenis
   van afgeronde work packages.

## Lokaal draaien

Vereist: Node.js, een lokale PostgreSQL-server, en een `.env`-bestand
(kopieer `.env.example` en vul minimaal `DATABASE_URL` in).

```bash
cp .env.example .env       # en vul DATABASE_URL in
npm install                # draait ook `prisma generate` (postinstall)
sudo service postgresql start
npx prisma migrate deploy  # database op het huidige schema brengen
npm run dev                # http://localhost:3000
```

## Belangrijke commando's

| Commando | Doet |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Migreert de database en bouwt een productiebuild |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit- en integratietests (vereist een lokale Postgres) |
| `npm run test:e2e` | Playwright-end-to-end-test tegen een eigen build + mock-Picnic-server |
| `npm run verify` | Lint + typecheck + tests + build in één keer — de kortste weg om te controleren of een wijziging klaar is |
| `npm run db:seed` | Seeddata inladen |

Zie `WORKFLOW.md` voor wanneer welke van deze commando's verplicht is
vóórdat een wijziging als "klaar" telt, en `OPERATIONS.md` voor de
achtergrond bij migraties en teststrategie.

## Deployment

Productie draait op Vercel (build) + Supabase (PostgreSQL). Migraties
draaien automatisch mee in elke deploy — zie `OPERATIONS.md` voor de
`DIRECT_URL`-configuratie die daarvoor nodig is.
