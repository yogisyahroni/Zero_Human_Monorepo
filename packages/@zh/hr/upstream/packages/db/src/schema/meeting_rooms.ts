import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const meetingRooms = pgTable(
  "meeting_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    division: text("division"),
    status: text("status").notNull().default("draft"),
    purpose: text("purpose"),
    agenda: jsonb("agenda").$type<string[]>().notNull().default([]),
    summary: text("summary"),
    outcome: jsonb("outcome").$type<Record<string, unknown>>(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("meeting_rooms_company_status_idx").on(table.companyId, table.status),
    companyDivisionIdx: index("meeting_rooms_company_division_idx").on(table.companyId, table.division),
    companyIssueIdx: index("meeting_rooms_company_issue_idx").on(table.companyId, table.issueId),
    companyProjectIdx: index("meeting_rooms_company_project_idx").on(table.companyId, table.projectId),
  }),
);

export const meetingRoomParticipants = pgTable(
  "meeting_room_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    meetingRoomId: uuid("meeting_room_id").notNull().references(() => meetingRooms.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    userId: text("user_id"),
    role: text("role").notNull().default("participant"),
    attendanceStatus: text("attendance_status").notNull().default("invited"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomIdx: index("meeting_room_participants_room_idx").on(table.meetingRoomId),
    companyAgentIdx: index("meeting_room_participants_company_agent_idx").on(table.companyId, table.agentId),
  }),
);

export const meetingRoomMessages = pgTable(
  "meeting_room_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    meetingRoomId: uuid("meeting_room_id").notNull().references(() => meetingRooms.id, { onDelete: "cascade" }),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id"),
    authorType: text("author_type").notNull().default("system"),
    body: text("body").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomCreatedAtIdx: index("meeting_room_messages_room_created_at_idx").on(table.meetingRoomId, table.createdAt),
    companyIdx: index("meeting_room_messages_company_idx").on(table.companyId),
  }),
);

export const meetingRoomDecisions = pgTable(
  "meeting_room_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    meetingRoomId: uuid("meeting_room_id").notNull().references(() => meetingRooms.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    rationale: text("rationale"),
    status: text("status").notNull().default("accepted"),
    decidedByAgentId: uuid("decided_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    decidedByUserId: text("decided_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomIdx: index("meeting_room_decisions_room_idx").on(table.meetingRoomId),
    companyIdx: index("meeting_room_decisions_company_idx").on(table.companyId),
  }),
);

export const meetingRoomActionItems = pgTable(
  "meeting_room_action_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    meetingRoomId: uuid("meeting_room_id").notNull().references(() => meetingRooms.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    assigneeUserId: text("assignee_user_id"),
    title: text("title").notNull(),
    status: text("status").notNull().default("todo"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomIdx: index("meeting_room_action_items_room_idx").on(table.meetingRoomId),
    companyStatusIdx: index("meeting_room_action_items_company_status_idx").on(table.companyId, table.status),
    issueIdx: index("meeting_room_action_items_issue_idx").on(table.issueId),
  }),
);

export const meetingRoomArtifactReferences = pgTable(
  "meeting_room_artifact_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    meetingRoomId: uuid("meeting_room_id").notNull().references(() => meetingRooms.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    artifactType: text("artifact_type").notNull(),
    artifactId: text("artifact_id"),
    title: text("title").notNull(),
    url: text("url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomIdx: index("meeting_room_artifact_references_room_idx").on(table.meetingRoomId),
    companyProviderIdx: index("meeting_room_artifact_references_company_provider_idx").on(table.companyId, table.provider),
  }),
);
