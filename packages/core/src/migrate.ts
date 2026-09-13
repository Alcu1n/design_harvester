import { pool } from "./db.ts";
await pool.query(`
CREATE TABLE IF NOT EXISTS app_settings(id text PRIMARY KEY,value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS designs(id uuid PRIMARY KEY,canonical_url text UNIQUE NOT NULL,title text,notes text NOT NULL DEFAULT '',tags jsonb NOT NULL DEFAULT '[]',default_version_id uuid,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS snapshots(id uuid PRIMARY KEY,design_id uuid NOT NULL REFERENCES designs(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS versions(id uuid PRIMARY KEY,design_id uuid NOT NULL REFERENCES designs(id) ON DELETE CASCADE,snapshot_id uuid NOT NULL REFERENCES snapshots(id),score integer,quality text NOT NULL DEFAULT 'PENDING',metadata jsonb NOT NULL,analysis jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tasks(id uuid PRIMARY KEY,design_id uuid NOT NULL REFERENCES designs(id) ON DELETE CASCADE,snapshot_id uuid NOT NULL,version_id uuid NOT NULL,kind text NOT NULL,status text NOT NULL DEFAULT 'QUEUED',stage text NOT NULL DEFAULT 'QUEUED',error jsonb,attempts integer NOT NULL DEFAULT 0,retry_at timestamptz,dispatched_at timestamptz,heartbeat_at timestamptz,cancel_requested boolean NOT NULL DEFAULT false,events jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
CREATE INDEX IF NOT EXISTS tasks_dispatch ON tasks(status,retry_at);
CREATE INDEX IF NOT EXISTS versions_design ON versions(design_id,created_at DESC);
CREATE TABLE IF NOT EXISTS deletion_queue(design_id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
`);
await pool.end();
console.log("数据库结构已就绪");
