import { z } from "zod";

export const meetingRoomStatusSchema = z.enum(["draft", "active", "summarizing", "closed", "archived"]);
export const meetingRoomParticipantRoleSchema = z.enum(["facilitator", "participant", "observer"]);
export const meetingRoomAttendanceStatusSchema = z.enum(["invited", "joined", "declined", "left"]);
export const meetingRoomMessageAuthorTypeSchema = z.enum(["agent", "user", "system"]);
export const meetingRoomDecisionStatusSchema = z.enum(["proposed", "accepted", "rejected", "superseded"]);
export const meetingRoomActionItemStatusSchema = z.enum(["todo", "in_progress", "done", "cancelled"]);
export const meetingRoomDispositionSchema = z.enum([
  "no_action",
  "decision_recorded",
  "issues_created",
  "blocked_by_owner",
  "hiring_requested",
]);

const optionalUuidSchema = z.string().uuid().optional().nullable();

export const meetingOutcomeSchema = z
  .object({
    disposition: meetingRoomDispositionSchema.optional(),
    decisions: z.array(z.string().trim().min(1).max(500)).optional(),
    blockers: z.array(z.string().trim().min(1).max(500)).optional(),
    actionItems: z.array(z.string().trim().min(1).max(500)).optional(),
    owners: z.array(z.string().trim().min(1).max(120)).optional(),
    dueDates: z.array(z.string().trim().min(1).max(120)).optional(),
    followUpIssueIds: z.array(z.string().uuid()).optional(),
    hiringRequests: z.array(z.string().trim().min(1).max(500)).optional(),
  })
  .passthrough();

export const meetingRoomParticipantInputSchema = z.object({
  agentId: optionalUuidSchema,
  userId: z.string().min(1).max(255).optional().nullable(),
  role: meetingRoomParticipantRoleSchema.optional().default("participant"),
  attendanceStatus: meetingRoomAttendanceStatusSchema.optional().default("invited"),
});

export const createMeetingRoomSchema = z.object({
  title: z.string().trim().min(1).max(240),
  projectId: optionalUuidSchema,
  issueId: optionalUuidSchema,
  division: z.string().trim().min(1).max(120).optional().nullable(),
  purpose: z.string().trim().max(4_000).optional().nullable(),
  agenda: z.array(z.string().trim().min(1).max(500)).max(50).optional().default([]),
  status: meetingRoomStatusSchema.optional().default("draft"),
  startedAt: z.coerce.date().optional().nullable(),
  participants: z.array(meetingRoomParticipantInputSchema).max(100).optional().default([]),
});

export type CreateMeetingRoom = z.infer<typeof createMeetingRoomSchema>;

export const updateMeetingRoomSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  projectId: optionalUuidSchema,
  issueId: optionalUuidSchema,
  division: z.string().trim().min(1).max(120).optional().nullable(),
  purpose: z.string().trim().max(4_000).optional().nullable(),
  agenda: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  status: meetingRoomStatusSchema.optional(),
  summary: z.string().trim().max(8_000).optional().nullable(),
  outcome: meetingOutcomeSchema.optional().nullable(),
  startedAt: z.coerce.date().optional().nullable(),
  closedAt: z.coerce.date().optional().nullable(),
});

export type UpdateMeetingRoom = z.infer<typeof updateMeetingRoomSchema>;

export const addMeetingRoomParticipantSchema = meetingRoomParticipantInputSchema;

export type AddMeetingRoomParticipant = z.infer<typeof addMeetingRoomParticipantSchema>;

export const addMeetingRoomMessageSchema = z.object({
  authorAgentId: optionalUuidSchema,
  authorUserId: z.string().min(1).max(255).optional().nullable(),
  authorType: meetingRoomMessageAuthorTypeSchema.optional(),
  body: z.string().trim().min(1).max(20_000),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type AddMeetingRoomMessage = z.infer<typeof addMeetingRoomMessageSchema>;

export const createMeetingRoomDecisionSchema = z.object({
  title: z.string().trim().min(1).max(500),
  rationale: z.string().trim().max(8_000).optional().nullable(),
  status: meetingRoomDecisionStatusSchema.optional().default("accepted"),
  decidedByAgentId: optionalUuidSchema,
  decidedByUserId: z.string().min(1).max(255).optional().nullable(),
});

export type CreateMeetingRoomDecision = z.infer<typeof createMeetingRoomDecisionSchema>;

export const updateMeetingRoomDecisionSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  rationale: z.string().trim().max(8_000).optional().nullable(),
  status: meetingRoomDecisionStatusSchema.optional(),
});

export type UpdateMeetingRoomDecision = z.infer<typeof updateMeetingRoomDecisionSchema>;

export const createMeetingRoomActionItemSchema = z.object({
  issueId: optionalUuidSchema,
  assigneeAgentId: optionalUuidSchema,
  assigneeUserId: z.string().min(1).max(255).optional().nullable(),
  title: z.string().trim().min(1).max(500),
  status: meetingRoomActionItemStatusSchema.optional().default("todo"),
  dueAt: z.coerce.date().optional().nullable(),
});

export type CreateMeetingRoomActionItem = z.infer<typeof createMeetingRoomActionItemSchema>;

export const createIssueFromMeetingActionItemSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(20_000).optional().nullable(),
  assigneeAgentId: optionalUuidSchema,
  assigneeUserId: z.string().min(1).max(255).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
  status: z.enum(["backlog", "todo", "in_progress"]).optional().default("todo"),
});

export type CreateIssueFromMeetingActionItem = z.infer<typeof createIssueFromMeetingActionItemSchema>;

export const requestMeetingHireSchema = z.object({
  role: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160).optional().nullable(),
  division: z.string().trim().min(1).max(120).optional().nullable(),
  reason: z.string().trim().min(1).max(4_000),
  skills: z.array(z.string().trim().min(1).max(80)).max(40).optional().default([]),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().default("high"),
});

export type RequestMeetingHire = z.infer<typeof requestMeetingHireSchema>;

export const createMeetingRoomArtifactReferenceSchema = z.object({
  provider: z.string().trim().min(1).max(120),
  artifactType: z.string().trim().min(1).max(120),
  artifactId: z.string().trim().min(1).max(255).optional().nullable(),
  title: z.string().trim().min(1).max(500),
  url: z.string().trim().url().max(2_000).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type CreateMeetingRoomArtifactReference = z.infer<typeof createMeetingRoomArtifactReferenceSchema>;
