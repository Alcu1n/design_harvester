import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
export const designs = pgTable("designs", {
  id: uuid().primaryKey(),
  canonicalUrl: text("canonical_url").notNull().unique(),
  title: text(),
  notes: text().notNull().default(""),
  tags: jsonb().$type<string[]>().notNull().default([]),
  defaultVersionId: uuid("default_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const snapshots = pgTable("snapshots", {
  id: uuid().primaryKey(),
  designId: uuid("design_id")
    .references(() => designs.id)
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const versions = pgTable("versions", {
  id: uuid().primaryKey(),
  designId: uuid("design_id")
    .references(() => designs.id)
    .notNull(),
  snapshotId: uuid("snapshot_id")
    .references(() => snapshots.id)
    .notNull(),
  score: integer(),
  quality: text().default("PENDING").notNull(),
  metadata: jsonb().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const tasks = pgTable("tasks", {
  id: uuid().primaryKey(),
  designId: uuid("design_id")
    .references(() => designs.id)
    .notNull(),
  snapshotId: uuid("snapshot_id").notNull(),
  versionId: uuid("version_id").notNull(),
  kind: text().notNull(),
  status: text().notNull().default("QUEUED"),
  stage: text().notNull().default("QUEUED"),
  error: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const appSettings = pgTable("app_settings", {
  id: text().primaryKey(),
  value: jsonb().notNull(),
});
