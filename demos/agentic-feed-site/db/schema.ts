import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  type: text("type").notNull(),
  settings: text("settings").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("accounts_username").on(table.username)]);

export const sessions = sqliteTable("account_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("account_sessions_user").on(table.userId)]);

export const events = sqliteTable("events", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  id: text("id").notNull(),
  userId: text("user_id").notNull().references(() => accounts.id),
  sessionId: text("session_id").notNull(),
  kind: text("kind").notNull(),
  comparisonId: text("comparison_id"),
  payload: text("payload").notNull(),
}, table => [uniqueIndex("events_comparison_once").on(table.kind, table.comparisonId).where(sql`${table.kind} IN ('evaluation', 'blind_presentation')`), uniqueIndex("events_id").on(table.id), index("events_user_sequence").on(table.userId, table.sequence), index("events_session").on(table.sessionId, table.sequence)]);

export const activeOperations = sqliteTable("active_operations", {
  userId: text("user_id").primaryKey().references(() => accounts.id),
  owner: text("owner").notNull(),
  kind: text("kind").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const progress = sqliteTable("progress", {
  sessionId: text("session_id").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id),
  payload: text("payload").notNull(),
});

export const sourceJobs = sqliteTable("source_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id),
  sessionId: text("session_id").notNull(),
  source: text("source").notNull(),
  query: text("query").notNull(),
  expiresAt: integer("expires_at").notNull(),
  result: text("result"),
}, table => [index("source_jobs_user").on(table.userId, table.expiresAt)]);

export const relayStatus = sqliteTable("relay_status", {
  name: text("name").primaryKey(),
  updatedAt: integer("updated_at").notNull(),
});
