import { pgTable, serial, text, varchar, integer, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";

// General Masaniello parameters
export const masanielloSettings = pgTable("masaniello_settings", {
  id: serial().primaryKey(),
  initialBankroll: numeric("initial_bankroll", { precision: 14, scale: 2, mode: "number" }).notNull(),
  totalEventsN: integer("total_events_n").notNull(),
  expectedEventsK: integer("expected_events_k").notNull(),
  averageOdds: numeric("average_odds", { precision: 8, scale: 3, mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Individual bet lines
export const masanielloEvents = pgTable("masaniello_events", {
  id: serial().primaryKey(),
  matchName: varchar("match_name", { length: 255 }).notNull(),
  selection: varchar({ length: 64 }).notNull(),
  odds: numeric({ precision: 8, scale: 3, mode: "number" }).notNull(),
  stake: numeric({ precision: 14, scale: 2, mode: "number" }).notNull(),
  status: varchar({ length: 16 }).notNull().default("Pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Raw pasted match lists
export const rawMatchesList = pgTable("raw_matches_list", {
  id: serial().primaryKey(),
  rawText: text("raw_text").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Full app snapshot (config, rows, options, raw match list) keyed by a sync code,
// so the same Masaniello can be opened on any device
export const masanielloSessions = pgTable("masaniello_sessions", {
  code: varchar({ length: 32 }).primaryKey(),
  title: varchar({ length: 255 }),
  state: jsonb().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
