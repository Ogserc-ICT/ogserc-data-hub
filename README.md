# OGSERC Data Hub

The Ogun State Electricity Market (OGEM) data platform. Licensees file their monthly returns into it; OGSERC uses it to monitor the market and issue the monthly OGEM Market Report.

The Hub follows the Commission's own working standard, set out in five workbooks:

| Commission workbook | What it provides |
|---|---|
| EMPR Ogun Electricity Market Analytics 2026 | Feeder and business-unit data dictionary, feeder register, Monthly Report layout, method, targets, thresholds |
| Feeder Register and SBT Monitoring v3 | Band breach testing, consecutive-month referrals, the referral log and form, data-quality checks |
| EMPR Ogun Generation Analytics 2026 | GenCo unit and plant returns and their KPIs, the generation licensee list |
| Generation Register and Plan Evaluation | Plant register (GP- IDs), and the 60-day plan evaluation with gates and weighted criteria |
| Load Forecast Baseline | Declared vs delivered demand, double-count correction, growth scenarios to 2036 |

Column headings, licensee codes (IBEDC, IE, EKEDP, GPDN, CCETC, OPP, NDPHC), business-unit names, Feeder IDs (OGF-33-0001…), plant IDs (GP-001…) and unit IDs (GP-001-U01…) follow the OGSERC Feeder and Plant ID Register, so the workbooks import directly.

## What the Hub does

**Returns**
- **Licensee Monthly Return** (Cover, Feeder List, Feeder Return, Commercial Return, Metering Return, Complaints Return).
- **GenCo Monthly Return** (Cover, Unit Return, Plant Return).
- **How returns arrive:**
  - Upload of the pre-filled datasheet, which each licensee downloads already listing its own feeders, business units and units.
  - Upload of the Commission workbooks, or the IBEDC, NERC and gencos layouts already in circulation.
  - API from licensee systems.
- **Checks on every row:**
  - Feeders are matched to the register by Feeder ID, any other ID or name, or name.
  - Core-field completeness is checked against the EMPR list of core fields.
  - Cross-field checks are applied.
  - Errors block filing; warnings are filed and reviewed.
- **Partial returns:** files that carry only some fields (the SBT monthly-hours sheet, the technical-data sheets) merge into the filed figures instead of replacing them.

**Monitoring**
- **Market overview and returns compliance.**
- **Feeder register:** each feeder's ID, unit, level, parent injection point, band, segment and tariff class, with a 12-month profile.
- **SBT monitor:** status against the band floor, consecutive-breach runs, and referral candidates. Referrals are logged and their status updated (Draft → Referred to Compliance → Compliance notice issued → Remedied / Band downgraded / Closed). A printable referral form goes through the Registry.
- **Generation:**
  - Plant register.
  - GenCo KPIs: capacity availability, capacity factor, forced outage rate, heat rate, energy lost to constraints, share to Ogun, collection and gas fill.
  - Plan workflow: record a plan, then score the gates and criteria. The recommendation and the 60-day deadline are calculated.
- **Load forecast:** declared and delivered average MW and the unserved share, with Low/Base/High scenarios to 2036.
- **Settings:** band floors, the 98% compliance threshold, SBT tolerance and consecutive months, watch and critical flags, market and generation targets, forecast assumptions, and plan score bands.

**Monthly OGEM Market Report**
- Covers the whole state, or one licensee (report reference `OGSERC/EMPR/FPR/YYYY/MM/<code>`).
- **Sections:**
  1. Executive summary
  2. Supply and reliability (indicator table: this month, previous, change, year to date, target, status)
  3. SBT band monitoring
  4. Commercial performance
  5. Licensee comparison and business-unit league
  6. Metering, estimated billing and energy caps
  7. Customer complaints
  8. Generation
  9. Demand and load forecast
  10. Commission operations
  11. Data quality and compliance with reporting obligations
  12. Regulatory findings and directives (editable, with suggested findings drawn from the data)
  13. Sign-off
- Analyst commentary for each section, Draft/Approved status, print to PDF, and an Excel data annex.

## Method

These methods follow the EMPR workbook:

- **No double counting.** Each injection point counts the higher of its own meter and the sum of the feeders drawn through it. A business unit gets the groups whose injection point lies in it.
- **Band met.** A feeder-month meets its band when its hours are at least 0.98 × the committed hours (Settings).
- **ATC&C.** 1 − billing efficiency × collection efficiency, uncapped, in kWh and in ₦. Collection efficiency for current bills excludes arrears recovered.
- **Estimation ratio.** Unmetered NMD kWh per customer ÷ metered NMD kWh per customer.
- **Received ÷ feeder-metered.** Energy received in the billing return ÷ de-duplicated feeder energy.

## Run locally

```bash
npm install
cp .env.example .env            # DATABASE_URL, AUTH_SECRET, SEED_ADMIN_*
npm run db:push
npm run seed                    # licensee master list, business units, administrator (sets a new password at first sign-in)
# load existing workbooks in this order (registers before returns):
npm run seed -- --import billing.xlsx gencos.xlsx feeder_clean.xlsx feeder_raw.xlsx =aliases \
  OGSERC_Feeder_and_Plant_ID_Register.xlsm SBT_Monitoring.xlsm Market_Analytics.xlsm caps.xlsx Generation_Analytics.xlsm Generation_Register.xlsm Load_Forecast.xlsx
npm run seed -- --examples      # optional example complaints and Commission activity (marked as examples)
npm run dev
```

The ID Register sets every feeder's OGSERC Feeder ID (OGF-…) and keeps earlier codes such as F001 as other IDs, so older files still match. Only IDs in the OGF- format are taken as Feeder IDs; a licensee's own codes are stored as other IDs.

`=aliases` applies three IBEDC feeder name mappings (Lafenwa, Tower, Egan) between IBEDC's own files and the OGSERC register. Confirm these with IBEDC.

## Deploy to Vercel

1. Push this folder to GitHub and import it in Vercel.
2. Add Postgres (Neon) from the Vercel Marketplace.
3. Set `AUTH_SECRET`, `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.
4. From your machine, against the production `DATABASE_URL`, run `npm run db:push`, then `npm run seed` and the imports.

Uploads accept files up to 4 MB (Vercel rejects requests over 4.5 MB). Split larger workbooks by month.

## API

```
POST /api/v1/submissions   Authorization: Bearer ogs_…
{ "dataset": "FEEDER", "confirm": true, "rows": [ { "period": "2026-07", "feederCode": "OGF-33-0065", "deliveredMwh": 727, … } ] }
GET  /api/v1/submissions/{id}
GET  /api/v1/datasets
```

Accepted `dataset` values: `REGISTER`, `FEEDER`, `COMMERCIAL`, `METERING`, `COMPLAINTS`, `GENUNIT`, `GENPLANT`. Column keys are listed on the Data standards page.

## Where to change things

| To change | Edit |
|---|---|
| Datasets and checks | `src/lib/datasets.ts` |
| Settings defaults | `src/lib/settings.ts` |
| Workbook readers | `src/lib/ingest/parsers.ts` |
| Filing | `src/lib/ingest/commit.ts` |
| Market calculations | `src/lib/metrics.ts` |
| SBT calculations | `src/lib/sbt.ts` |
| Generation calculations | `src/lib/generation.ts` |
| Forecast calculations | `src/lib/forecast.ts` |
| Report | `src/app/(app)/report/page.tsx` |

## Security and controls

- **Sign-in rate limiting.** Five failed attempts on one email within 15 minutes locks that email for 15 minutes; 25 failures from one IP address locks that address. Counters live in the `login_throttle` table, so this works on serverless hosting.
- **API rate limiting.** 120 requests per 10 minutes per API key, and 20 requests with a missing or wrong key per IP address per 15 minutes. Over the limit, the API answers `429` with a `Retry-After` header.
- **Temporary passwords.** Accounts created by an administrator, the seeded administrator, and every password reset use a temporary password. The user must choose their own at first sign-in before anything else.
- **Change password.** Every user can change their password from **Account** in the header. Changing, resetting or deactivating signs that user out everywhere.
- **Retired licensees.** Retiring a licensee ends its officers' sessions and stops them signing in.
- **Separation of duties.** Whoever filed a submission cannot accept or query it; another Commission user must. Initial data loads from `npm run seed -- --import` are not attributed to any user, so the administrator can review them.
- **Queries need a reason.** A query must say what the licensee should correct or explain.
- **One upload, one batch.** Every submission staged from the same uploaded workbook shares an upload ID, so confirming a return also files that workbook's own feeder register, and never one from another upload with the same file name.

## Before go-live

- Remove example data with `DELETE FROM submissions WHERE is_example;`. Its rows and filings go with it.
- Set real targets in Settings. The current ones are the EMPR workbook's placeholders.
- Uploaded workbooks are stored in Postgres. Watch the database size (Neon's free tier is 0.5 GB); moving files to Vercel Blob is the long-term fix.
- "Forgot password" by email needs an email provider. Until then, the administrator issues a temporary password from Admin.
