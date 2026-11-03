import {
  pgTable, text, uuid, timestamp, jsonb, integer, boolean, doublePrecision, uniqueIndex, index, customType, primaryKey,
} from "drizzle-orm/pg-core";
import type { DatasetCode } from "@/lib/datasets";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// ---------------------------------------------------------------- registry

export const licensees = pgTable("licensees", {
  id: text("id").primaryKey(), // short code, e.g. "ibedc"
  name: text("name").notNull(),
  area: text("area").notNull(),
  type: text("type").notNull(), // Successor DisCo, IEDN, IEDN / embedded network, Generation, Integrated, Mini-grid
  code: text("code").notNull().default(""), // OGSERC licensee code, e.g. IBEDC
  shortName: text("short_name").notNull().default(""),
  licenceStatus: text("licence_status").notNull().default("Licensed"),
  /** Datasets this licensee must return each month. */
  obligations: jsonb("obligations").$type<DatasetCode[]>().notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

/** Business hubs / business units. Aliases absorb spelling differences between source files. */
export const hubs = pgTable("hubs", {
  id: text("id").primaryKey(), // `${licensee}:${CODE}`
  licenseeId: text("licensee_id").notNull().references(() => licensees.id),
  name: text("name").notNull(),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
});

export const feeders = pgTable(
  "feeders",
  {
    id: text("id").primaryKey(), // `${licensee}:${loose name key}`
    licenseeId: text("licensee_id").notNull().references(() => licensees.id),
    code: text("code"), // OGSERC Feeder ID, e.g. OGF-33-0001 (issued by OGSERC only)
    name: text("name").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]), // other names and IDs used in returns
    voltage: text("voltage").$type<"33kV" | "11kV" | "Other">().notNull(),
    level: text("level").$type<"Injection" | "Fed">(), // Injection = 33 kV point; Fed = draws through a parent
    hubId: text("hub_id").references(() => hubs.id),
    parentId: text("parent_id"),
    band: text("band"),
    segment: text("segment"), // MD / NMD / Mixed
    tariffClass: text("tariff_class"), // NMD / MD1 / MD2 / Mixed
    classificationBasis: text("classification_basis"),
    status: text("status").notNull().default("Active"),
    attrs: jsonb("attrs").$type<Record<string, string | number | null>>().notNull().default({}), // substation, rating, route km, DTs, LGA…
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("feeders_code").on(t.licenseeId, t.code)],
);

/** Generating plants serving Ogun State: grid stations, IPPs, embedded, captive and off-grid. */
export const generationAssets = pgTable("generation_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").unique(), // OGSERC plant ID, e.g. GP-001
  name: text("name").notNull(),
  matchKey: text("match_key").notNull(), // name key; plants of the same name are told apart by location
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  owner: text("owner").notNull().default(""),
  licenseeId: text("licensee_id").references(() => licensees.id),
  location: text("location").notNull().default(""),
  lga: text("lga").notNull().default(""),
  capacityMw: doublePrecision("capacity_mw"),
  availableMw: doublePrecision("available_mw"),
  fuel: text("fuel").notNull().default(""),
  technology: text("technology").notNull().default(""),
  category: text("category").notNull().default(""), // Grid (TCN), IPP, Embedded, Captive, Off-grid, Mini-grid
  status: text("status").notNull().default(""),
  permitStatus: text("permit_status").notNull().default("Not recorded"),
  planStatus: text("plan_status").notNull().default(""),
  nextPlanDue: text("next_plan_due"),
  attrs: jsonb("attrs").$type<Record<string, string | number | null>>().notNull().default({}),
  sources: jsonb("sources").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- people

export type Role = "admin" | "reviewer" | "licensee";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<Role>().notNull(),
  licenseeId: text("licensee_id").references(() => licensees.id),
  active: boolean("active").notNull().default(true),
  /** Set when an administrator creates the account or resets the password; the user must choose a new one at next sign-in. */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** Bumped on every password change, reset or deactivation, which signs the user out of all existing sessions. */
  sessionVersion: integer("session_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Rate-limit counters: failed sign-ins ("email:…", "ip:…") and API calls ("api:<key id>", "apiauth:<ip>"). */
export const loginThrottle = pgTable("login_throttle", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

/** Machine access for licensee systems. Only a SHA-256 hash of the key is stored. */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  licenseeId: text("licensee_id").notNull().references(() => licensees.id),
  label: text("label").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ---------------------------------------------------------------- submissions

export type SubmissionStatus = "staged" | "received" | "accepted" | "queried" | "superseded" | "discarded";
export type Issue = { level: "error" | "warning"; period?: string; ref?: string; message: string };

/**
 * One upload or API call for one licensee and dataset, possibly covering several months.
 * Staged until the submitter confirms; then its rows go into the data tables.
 */
export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    licenseeId: text("licensee_id").references(() => licensees.id), // null for Commission reference data
    dataset: text("dataset").$type<DatasetCode>().notNull(),
    periods: jsonb("periods").$type<string[]>().notNull(),
    format: text("format").notNull(), // which parser read it
    channel: text("channel").$type<"upload" | "api" | "form">().notNull(),
    fileName: text("file_name"),
    /** Shared by every submission staged from one uploaded workbook, so its parts are confirmed together. */
    uploadId: uuid("upload_id"),
    file: bytea("file"),
    rowCount: integer("row_count").notNull(),
    rows: jsonb("rows").$type<Record<string, unknown>[]>().notNull(), // parsed rows, kept for audit and re-processing
    issues: jsonb("issues").$type<Issue[]>().notNull(),
    status: text("status").$type<SubmissionStatus>().notNull(),
    submittedById: uuid("submitted_by_id").references(() => users.id),
    submittedByName: text("submitted_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    reviewNote: text("review_note").notNull().default(""),
    reviewedById: uuid("reviewed_by_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    isExample: boolean("is_example").notNull().default(false),
    /** True when the return carries only some fields (e.g. hours only); filing merges instead of replacing. */
    partial: boolean("partial").notNull().default(false),
    reference: text("reference"), // licensee's submission reference, e.g. RET-IBEDC-2026-06
  },
  (t) => [index("submissions_lic_ds").on(t.licenseeId, t.dataset), index("submissions_status").on(t.status), index("submissions_upload").on(t.uploadId)],
);

/** Which submission currently supplies the data for a licensee, dataset and month. */
export const filings = pgTable(
  "filings",
  {
    licenseeId: text("licensee_id").notNull(), // "ogserc" for Commission reference data
    dataset: text("dataset").$type<DatasetCode>().notNull(),
    period: text("period").notNull(),
    submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.licenseeId, t.dataset, t.period] })],
);

// ---------------------------------------------------------------- data tables (one row per item per month)

const sub = () => uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" });

export const feederMonthly = pgTable(
  "feeder_monthly",
  {
    licenseeId: text("licensee_id").notNull(),
    feederId: text("feeder_id").notNull().references(() => feeders.id),
    period: text("period").notNull(),
    band: text("band").notNull(),
    bandHours: doublePrecision("band_hours").notNull(), // regulatory floor for the band
    hoursPerDay: doublePrecision("hours_per_day"),
    deliveredMwh: doublePrecision("delivered_mwh"),
    nominatedMwh: doublePrecision("nominated_mwh"),
    interruptions: integer("interruptions"),
    ext: jsonb("ext").$type<Record<string, number | string | null>>().notNull().default({}),
    submissionId: sub(),
  },
  (t) => [uniqueIndex("feeder_monthly_u").on(t.feederId, t.period), index("feeder_monthly_p").on(t.period)],
);

export const commercialMonthly = pgTable(
  "commercial_monthly",
  {
    licenseeId: text("licensee_id").notNull(),
    hubId: text("hub_id").notNull().references(() => hubs.id),
    period: text("period").notNull(),
    custMeteredMd: integer("cust_metered_md"),
    custMeteredNmd: integer("cust_metered_nmd"),
    custUnmeteredMd: integer("cust_unmetered_md"),
    custUnmeteredNmd: integer("cust_unmetered_nmd"),
    energyReceivedKwh: doublePrecision("energy_received_kwh"),
    energyReceivedNgn: doublePrecision("energy_received_ngn"),
    billedKwhMeteredMd: doublePrecision("billed_kwh_metered_md"),
    billedKwhMeteredNmd: doublePrecision("billed_kwh_metered_nmd"),
    billedKwhUnmeteredMd: doublePrecision("billed_kwh_unmetered_md"),
    billedKwhUnmeteredNmd: doublePrecision("billed_kwh_unmetered_nmd"),
    billedNgnMd: doublePrecision("billed_ngn_md"),
    billedNgnNmd: doublePrecision("billed_ngn_nmd"),
    collectedNgnMd: doublePrecision("collected_ngn_md"),
    collectedNgnNmd: doublePrecision("collected_ngn_nmd"),
    arrearsNgn: doublePrecision("arrears_ngn"),
    ext: jsonb("ext").$type<Record<string, number | string | null>>().notNull().default({}),
    submissionId: sub(),
  },
  (t) => [uniqueIndex("commercial_monthly_u").on(t.hubId, t.period), index("commercial_monthly_p").on(t.period)],
);

export const meteringMonthly = pgTable(
  "metering_monthly",
  {
    licenseeId: text("licensee_id").notNull(),
    hubId: text("hub_id").notNull().references(() => hubs.id),
    period: text("period").notNull(),
    installedMap: integer("installed_map"),
    installedMaf: integer("installed_maf"),
    installedVendor: integer("installed_vendor"),
    installedDisco: integer("installed_disco"),
    replaced: integer("replaced"),
    faultyReported: integer("faulty_reported"),
    pendingApplications: integer("pending_applications"),
    submissionId: sub(),
  },
  (t) => [uniqueIndex("metering_monthly_u").on(t.hubId, t.period)],
);

export const complaintsMonthly = pgTable(
  "complaints_monthly",
  {
    licenseeId: text("licensee_id").notNull(),
    period: text("period").notNull(),
    category: text("category").notNull(),
    received: integer("received").notNull(),
    resolved: integer("resolved").notNull(),
    resolvedInTime: integer("resolved_in_time"),
    escalated: integer("escalated"),
    submissionId: sub(),
  },
  (t) => [uniqueIndex("complaints_monthly_u").on(t.licenseeId, t.period, t.category)],
);

/** Generating units returned by generation licensees (OGSERC GenCo Monthly Return, unit sheet). */
export const genUnitMonthly = pgTable(
  "gen_unit_monthly",
  {
    licenseeId: text("licensee_id").notNull(),
    plantCode: text("plant_code").notNull(),
    unitCode: text("unit_code").notNull(),
    period: text("period").notNull(),
    installedMw: doublePrecision("installed_mw"),
    availableMw: doublePrecision("available_mw"),
    netMwh: doublePrecision("net_mwh"),
    operatingHours: doublePrecision("operating_hours"),
    forcedOutageHours: doublePrecision("forced_outage_hours"),
    ext: jsonb("ext").$type<Record<string, number | string | null>>().notNull().default({}),
    submissionId: sub(),
  },
  (t) => [uniqueIndex("gen_unit_monthly_u").on(t.licenseeId, t.unitCode, t.period)],
);

/** Plant-level offtake, invoicing, fuel supply and safety (GenCo Monthly Return, plant sheet). */
export const genPlantMonthly = pgTable(
  "gen_plant_monthly",
  {
    licenseeId: text("licensee_id").notNull(),
    plantCode: text("plant_code").notNull(),
    period: text("period").notNull(),
    ext: jsonb("ext").$type<Record<string, number | string | null>>().notNull().default({}),
    submissionId: sub(),
  },
  (t) => [uniqueIndex("gen_plant_monthly_u").on(t.licenseeId, t.plantCode, t.period)],
);

/** NERC/OGSERC monthly energy caps for unmetered non-MD customers, per feeder. */
export const energyCaps = pgTable(
  "energy_caps",
  {
    licenseeId: text("licensee_id").notNull(),
    period: text("period").notNull(),
    hubId: text("hub_id"),
    feederName: text("feeder_name").notNull(),
    feederId: text("feeder_id"),
    band: text("band"),
    capKwh: doublePrecision("cap_kwh").notNull(),
    submissionId: sub(),
  },
  (t) => [uniqueIndex("energy_caps_u").on(t.licenseeId, t.period, t.feederName)],
);

// ---------------------------------------------------------------- Commission

/** OGSERC's own monthly operational indicators (licensing, enforcement, hearings, CCU, staffing). */
export const commissionMonthly = pgTable(
  "commission_monthly",
  {
    period: text("period").notNull(),
    indicator: text("indicator").notNull(),
    value: doublePrecision("value"),
    note: text("note").notNull().default(""),
    updatedById: uuid("updated_by_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.period, t.indicator] })],
);

/** Editable narrative for each section of the monthly market report. */
export const reportNotes = pgTable(
  "report_notes",
  {
    period: text("period").notNull(),
    section: text("section").notNull(),
    body: text("body").notNull(),
    status: text("status").$type<"draft" | "approved">().notNull().default("draft"),
    updatedById: uuid("updated_by_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.period, t.section] })],
);

// ---------------------------------------------------------------- regulatory casework

/** Service-based tariff band breach referrals to Compliance (Performance Monitoring unit). */
export const referrals = pgTable("referrals", {
  ref: text("ref").primaryKey(), // OGSERC/PM/SBT/2026/001
  licenseeId: text("licensee_id").notNull().references(() => licensees.id),
  feederId: text("feeder_id"),
  feederName: text("feeder_name").notNull(),
  band: text("band"),
  floorHours: doublePrecision("floor_hours"),
  hub: text("hub"),
  monthsBreached: integer("months_breached"),
  avgHours: doublePrecision("avg_hours"),
  shortfall: doublePrecision("shortfall"),
  dataQualityFlag: text("data_quality_flag"),
  referredOn: text("referred_on").notNull(), // YYYY-MM-DD
  referredBy: text("referred_by").notNull().default(""),
  status: text("status").notNull(),
  caseNo: text("case_no"),
  closedOn: text("closed_on"),
  notes: text("notes").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** GenCo capacity recovery and expansion plans, and their evaluation (gates + weighted criteria). */
export const planEvaluations = pgTable("plan_evaluations", {
  id: text("id").primaryKey(), // EV-001
  plantId: uuid("plant_id").references(() => generationAssets.id),
  plantName: text("plant_name").notNull(),
  planType: text("plan_type").$type<"Capacity recovery" | "Expansion">().notNull(),
  receivedOn: text("received_on").notNull(),
  decidedOn: text("decided_on"),
  gates: jsonb("gates").$type<Record<string, "Yes" | "No" | null>>().notNull().default({}),
  scores: jsonb("scores").$type<Record<string, number | null>>().notNull().default({}),
  recommendation: text("recommendation"),
  leadEvaluator: text("lead_evaluator").notNull().default(""),
  conditions: text("conditions").notNull().default(""),
  isExample: boolean("is_example").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Commission settings: band floors, thresholds, targets, SBT rules, forecast assumptions, evaluation criteria. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedById: uuid("updated_by_id").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Licensee = typeof licensees.$inferSelect;
export type User = typeof users.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Hub = typeof hubs.$inferSelect;
export type Feeder = typeof feeders.$inferSelect;
