CREATE TABLE IF NOT EXISTS "meeting_rooms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "issue_id" uuid REFERENCES "issues"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "division" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "purpose" text,
  "agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "summary" text,
  "outcome" jsonb,
  "created_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "created_by_user_id" text,
  "started_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "meeting_rooms_company_status_idx" ON "meeting_rooms" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "meeting_rooms_company_division_idx" ON "meeting_rooms" ("company_id", "division");
CREATE INDEX IF NOT EXISTS "meeting_rooms_company_issue_idx" ON "meeting_rooms" ("company_id", "issue_id");
CREATE INDEX IF NOT EXISTS "meeting_rooms_company_project_idx" ON "meeting_rooms" ("company_id", "project_id");

CREATE TABLE IF NOT EXISTS "meeting_room_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "meeting_room_id" uuid NOT NULL REFERENCES "meeting_rooms"("id") ON DELETE CASCADE,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "user_id" text,
  "role" text DEFAULT 'participant' NOT NULL,
  "attendance_status" text DEFAULT 'invited' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "meeting_room_participants_room_idx" ON "meeting_room_participants" ("meeting_room_id");
CREATE INDEX IF NOT EXISTS "meeting_room_participants_company_agent_idx" ON "meeting_room_participants" ("company_id", "agent_id");

CREATE TABLE IF NOT EXISTS "meeting_room_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "meeting_room_id" uuid NOT NULL REFERENCES "meeting_rooms"("id") ON DELETE CASCADE,
  "author_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "author_user_id" text,
  "author_type" text DEFAULT 'system' NOT NULL,
  "body" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "meeting_room_messages_room_created_idx" ON "meeting_room_messages" ("meeting_room_id", "created_at");
CREATE INDEX IF NOT EXISTS "meeting_room_messages_company_idx" ON "meeting_room_messages" ("company_id");

CREATE TABLE IF NOT EXISTS "meeting_room_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "meeting_room_id" uuid NOT NULL REFERENCES "meeting_rooms"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "rationale" text,
  "status" text DEFAULT 'accepted' NOT NULL,
  "decided_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "decided_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "meeting_room_decisions_room_idx" ON "meeting_room_decisions" ("meeting_room_id");
CREATE INDEX IF NOT EXISTS "meeting_room_decisions_company_idx" ON "meeting_room_decisions" ("company_id");

CREATE TABLE IF NOT EXISTS "meeting_room_action_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "meeting_room_id" uuid NOT NULL REFERENCES "meeting_rooms"("id") ON DELETE CASCADE,
  "issue_id" uuid REFERENCES "issues"("id") ON DELETE SET NULL,
  "assignee_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "assignee_user_id" text,
  "title" text NOT NULL,
  "status" text DEFAULT 'todo' NOT NULL,
  "due_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "meeting_room_action_items_room_idx" ON "meeting_room_action_items" ("meeting_room_id");
CREATE INDEX IF NOT EXISTS "meeting_room_action_items_company_status_idx" ON "meeting_room_action_items" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "meeting_room_action_items_issue_idx" ON "meeting_room_action_items" ("issue_id");

CREATE TABLE IF NOT EXISTS "meeting_room_artifact_references" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "meeting_room_id" uuid NOT NULL REFERENCES "meeting_rooms"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "artifact_type" text NOT NULL,
  "artifact_id" text,
  "title" text NOT NULL,
  "url" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "meeting_room_artifact_references_room_idx" ON "meeting_room_artifact_references" ("meeting_room_id");
CREATE INDEX IF NOT EXISTS "meeting_room_artifact_references_company_provider_idx" ON "meeting_room_artifact_references" ("company_id", "provider");
