import { Router } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  issues,
  meetingRoomActionItems,
  meetingRoomArtifactReferences,
  meetingRoomDecisions,
  meetingRoomMessages,
  meetingRoomParticipants,
  meetingRooms,
  projects,
} from "@paperclipai/db";
import {
  addMeetingRoomMessageSchema,
  addMeetingRoomParticipantSchema,
  createMeetingRoomActionItemSchema,
  createMeetingRoomArtifactReferenceSchema,
  createMeetingRoomDecisionSchema,
  createMeetingRoomSchema,
  updateMeetingRoomSchema,
} from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

type EntityKind = "agent" | "issue" | "project";

export function meetingRoomRoutes(db: Db) {
  const router = Router();

  async function getRoom(companyId: string, roomId: string) {
    const [room] = await db
      .select()
      .from(meetingRooms)
      .where(and(eq(meetingRooms.companyId, companyId), eq(meetingRooms.id, roomId)))
      .limit(1);
    return room ?? null;
  }

  async function assertEntityBelongsToCompany(kind: EntityKind, companyId: string, id: string | null | undefined) {
    if (!id) return;
    const table = kind === "agent" ? agents : kind === "issue" ? issues : projects;
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.companyId, companyId), eq(table.id, id)))
      .limit(1);
    if (!row) {
      throw unprocessable(`${kind} does not belong to this company`);
    }
  }

  router.get("/companies/:companyId/meeting-rooms", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const filters = [
      eq(meetingRooms.companyId, companyId),
      typeof req.query.status === "string" ? eq(meetingRooms.status, req.query.status) : undefined,
      typeof req.query.division === "string" ? eq(meetingRooms.division, req.query.division) : undefined,
      typeof req.query.issueId === "string" ? eq(meetingRooms.issueId, req.query.issueId) : undefined,
      typeof req.query.projectId === "string" ? eq(meetingRooms.projectId, req.query.projectId) : undefined,
    ].filter(Boolean);

    const rooms = await db
      .select()
      .from(meetingRooms)
      .where(and(...filters))
      .orderBy(desc(meetingRooms.createdAt))
      .limit(100);

    res.json({ rooms });
  });

  router.post("/companies/:companyId/meeting-rooms", validate(createMeetingRoomSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const body = req.body;

    await Promise.all([
      assertEntityBelongsToCompany("project", companyId, body.projectId),
      assertEntityBelongsToCompany("issue", companyId, body.issueId),
      ...body.participants.map((participant: { agentId?: string | null }) =>
        assertEntityBelongsToCompany("agent", companyId, participant.agentId),
      ),
    ]);

    const [room] = await db
      .insert(meetingRooms)
      .values({
        companyId,
        projectId: body.projectId ?? null,
        issueId: body.issueId ?? null,
        title: body.title,
        division: body.division ?? null,
        status: body.status,
        purpose: body.purpose ?? null,
        agenda: body.agenda,
        createdByAgentId: actor.agentId ?? null,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
        startedAt: body.startedAt ?? null,
      })
      .returning();

    if (!room) {
      throw unprocessable("Meeting room was not created");
    }

    if (body.participants.length > 0) {
      await db.insert(meetingRoomParticipants).values(
        body.participants.map((participant: {
          agentId?: string | null;
          userId?: string | null;
          role: string;
          attendanceStatus: string;
        }) => ({
          companyId,
          meetingRoomId: room.id,
          agentId: participant.agentId ?? null,
          userId: participant.userId ?? null,
          role: participant.role,
          attendanceStatus: participant.attendanceStatus,
        })),
      );
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "meeting_room.created",
      entityType: "meeting_room",
      entityId: room.id,
      details: { title: room.title, division: room.division },
    });

    res.status(201).json(room);
  });

  router.get("/companies/:companyId/meeting-rooms/:roomId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    const room = await getRoom(companyId, roomId);
    if (!room) throw notFound("Meeting room not found");

    const [participants, messages, decisions, actionItems, artifactReferences] = await Promise.all([
      db.select().from(meetingRoomParticipants).where(eq(meetingRoomParticipants.meetingRoomId, roomId)),
      db
        .select()
        .from(meetingRoomMessages)
        .where(eq(meetingRoomMessages.meetingRoomId, roomId))
        .orderBy(asc(meetingRoomMessages.createdAt)),
      db.select().from(meetingRoomDecisions).where(eq(meetingRoomDecisions.meetingRoomId, roomId)),
      db.select().from(meetingRoomActionItems).where(eq(meetingRoomActionItems.meetingRoomId, roomId)),
      db.select().from(meetingRoomArtifactReferences).where(eq(meetingRoomArtifactReferences.meetingRoomId, roomId)),
    ]);

    res.json({ room, participants, messages, decisions, actionItems, artifactReferences });
  });

  router.patch("/companies/:companyId/meeting-rooms/:roomId", validate(updateMeetingRoomSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    const existing = await getRoom(companyId, roomId);
    if (!existing) throw notFound("Meeting room not found");
    const body = req.body;

    await Promise.all([
      assertEntityBelongsToCompany("project", companyId, body.projectId),
      assertEntityBelongsToCompany("issue", companyId, body.issueId),
    ]);

    const now = new Date();
    const [room] = await db
      .update(meetingRooms)
      .set({
        ...body,
        projectId: body.projectId === undefined ? existing.projectId : body.projectId ?? null,
        issueId: body.issueId === undefined ? existing.issueId : body.issueId ?? null,
        division: body.division === undefined ? existing.division : body.division ?? null,
        purpose: body.purpose === undefined ? existing.purpose : body.purpose ?? null,
        summary: body.summary === undefined ? existing.summary : body.summary ?? null,
        outcome: body.outcome === undefined ? existing.outcome : body.outcome ?? null,
        closedAt:
          body.closedAt === undefined && (body.status === "closed" || body.status === "archived")
            ? now
            : body.closedAt ?? existing.closedAt,
        updatedAt: now,
      })
      .where(and(eq(meetingRooms.companyId, companyId), eq(meetingRooms.id, roomId)))
      .returning();

    res.json(room);
  });

  router.post(
    "/companies/:companyId/meeting-rooms/:roomId/participants",
    validate(addMeetingRoomParticipantSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      assertCompanyAccess(req, companyId);
      if (!(await getRoom(companyId, roomId))) throw notFound("Meeting room not found");
      await assertEntityBelongsToCompany("agent", companyId, req.body.agentId);

      const [participant] = await db
        .insert(meetingRoomParticipants)
        .values({
          companyId,
          meetingRoomId: roomId,
          agentId: req.body.agentId ?? null,
          userId: req.body.userId ?? null,
          role: req.body.role,
          attendanceStatus: req.body.attendanceStatus,
        })
        .returning();

      res.status(201).json(participant);
    },
  );

  router.post("/companies/:companyId/meeting-rooms/:roomId/messages", validate(addMeetingRoomMessageSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    if (!(await getRoom(companyId, roomId))) throw notFound("Meeting room not found");
    await assertEntityBelongsToCompany("agent", companyId, req.body.authorAgentId);
    const actor = getActorInfo(req);

    const authorType = req.body.authorType ?? actor.actorType;
    const [message] = await db
      .insert(meetingRoomMessages)
      .values({
        companyId,
        meetingRoomId: roomId,
        authorAgentId: req.body.authorAgentId ?? actor.agentId ?? null,
        authorUserId: req.body.authorUserId ?? (actor.actorType === "user" ? actor.actorId : null),
        authorType,
        body: req.body.body,
        metadata: req.body.metadata ?? null,
      })
      .returning();

    res.status(201).json(message);
  });

  router.post(
    "/companies/:companyId/meeting-rooms/:roomId/decisions",
    validate(createMeetingRoomDecisionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      assertCompanyAccess(req, companyId);
      if (!(await getRoom(companyId, roomId))) throw notFound("Meeting room not found");
      await assertEntityBelongsToCompany("agent", companyId, req.body.decidedByAgentId);
      const actor = getActorInfo(req);

      const [decision] = await db
        .insert(meetingRoomDecisions)
        .values({
          companyId,
          meetingRoomId: roomId,
          title: req.body.title,
          rationale: req.body.rationale ?? null,
          status: req.body.status,
          decidedByAgentId: req.body.decidedByAgentId ?? actor.agentId ?? null,
          decidedByUserId: req.body.decidedByUserId ?? (actor.actorType === "user" ? actor.actorId : null),
        })
        .returning();

      res.status(201).json(decision);
    },
  );

  router.post(
    "/companies/:companyId/meeting-rooms/:roomId/action-items",
    validate(createMeetingRoomActionItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      assertCompanyAccess(req, companyId);
      if (!(await getRoom(companyId, roomId))) throw notFound("Meeting room not found");
      await Promise.all([
        assertEntityBelongsToCompany("issue", companyId, req.body.issueId),
        assertEntityBelongsToCompany("agent", companyId, req.body.assigneeAgentId),
      ]);

      const [actionItem] = await db
        .insert(meetingRoomActionItems)
        .values({
          companyId,
          meetingRoomId: roomId,
          issueId: req.body.issueId ?? null,
          assigneeAgentId: req.body.assigneeAgentId ?? null,
          assigneeUserId: req.body.assigneeUserId ?? null,
          title: req.body.title,
          status: req.body.status,
          dueAt: req.body.dueAt ?? null,
        })
        .returning();

      res.status(201).json(actionItem);
    },
  );

  router.post(
    "/companies/:companyId/meeting-rooms/:roomId/artifact-references",
    validate(createMeetingRoomArtifactReferenceSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      assertCompanyAccess(req, companyId);
      if (!(await getRoom(companyId, roomId))) throw notFound("Meeting room not found");

      const [artifactReference] = await db
        .insert(meetingRoomArtifactReferences)
        .values({
          companyId,
          meetingRoomId: roomId,
          provider: req.body.provider,
          artifactType: req.body.artifactType,
          artifactId: req.body.artifactId ?? null,
          title: req.body.title,
          url: req.body.url ?? null,
          metadata: req.body.metadata ?? null,
        })
        .returning();

      res.status(201).json(artifactReference);
    },
  );

  return router;
}
