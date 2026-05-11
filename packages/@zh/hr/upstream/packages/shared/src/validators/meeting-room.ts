import { z } from "zod";

export const meetingRoomStatusSchema = z.enum(["draft", "active", "summarizing", "closed", "archived"]);
export const meetingRoomParticipantRoleSchema = z.enum(["facilitator", "participant", "observer"]);
export const meetingRoomAttendanceStatusSchema = z.enum(["invited", "joined", "declined", "left"]);
export const meetingRoomMessageAuthorTypeSchema = z.enum(["agent", "user", "system"]);
export const meetingRoomDecisionStatusSchema = z.enum(["proposed", "accepted", "rejected", "superseded"]);
export const meetingRoomActionItemStatusSchema = z.enum(["todo", "in_progress", "done", "cancelled"]);

const optionalUuidSchema = z.string().uuid().optional().nullable();

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
  outcome: z.record(z.unknown()).optional().nullable(),
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

export const createMeetingRoomActionItemSchema = z.object({
  issueId: optionalUuidSchema,
  assigneeAgentId: optionalUuidSchema,
  assigneeUserId: z.string().min(1).max(255).optional().nullable(),
  title: z.string().trim().min(1).max(500),
  status: meetingRoomActionItemStatusSchema.optional().default("todo"),
  dueAt: z.coerce.date().optional().nullable(),
});

export type CreateMeetingRoomActionItem = z.infer<typeof createMeetingRoomActionItemSchema>;

export const createMeetingRoomArtifactReferenceSchema = z.object({
  provider: z.string().trim().min(1).max(120),
  artifactType: z.string().trim().min(1).max(120),
  artifactId: z.string().trim().min(1).max(255).optional().nullable(),
  title: z.string().trim().min(1).max(500),
  url: z.string().trim().url().max(2_000).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type CreateMeetingRoomArtifactReference = z.infer<typeof createMeetingRoomArtifactReferenceSchema>;
