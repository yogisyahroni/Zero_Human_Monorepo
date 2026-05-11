import { Router } from "express";
import { and, asc, count, desc, eq } from "drizzle-orm";
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
  createIssueFromMeetingActionItemSchema,
  createMeetingRoomActionItemSchema,
  createMeetingRoomArtifactReferenceSchema,
  createMeetingRoomDecisionSchema,
  createMeetingRoomSchema,
  meetingRoomDispositionSchema,
  requestMeetingHireSchema,
  updateMeetingRoomDecisionSchema,
  updateMeetingRoomSchema,
} from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { issueService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

type EntityKind = "agent" | "issue" | "project";

export function meetingRoomRoutes(db: Db) {
  const router = Router();
  const issuesSvc = issueService(db);

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

  function readOutcomeDisposition(outcome: unknown) {
    if (!outcome || typeof outcome !== "object") return null;
    const parsed = meetingRoomDispositionSchema.safeParse((outcome as Record<string, unknown>).disposition);
    return parsed.success ? parsed.data : null;
  }

  function mergeOutcomeList(
    outcome: Record<string, unknown> | null,
    key: "followUpIssueIds" | "hiringRequests",
    value: string,
  ) {
    const next: Record<string, unknown> = { ...(outcome ?? {}) };
    const existing = Array.isArray(next[key]) ? next[key].filter((item): item is string => typeof item === "string") : [];
    next[key] = [...new Set([...existing, value])];
    return next;
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

    const [rooms, participantCounts] = await Promise.all([
      db
      .select()
      .from(meetingRooms)
      .where(and(...filters))
      .orderBy(desc(meetingRooms.createdAt))
        .limit(100),
      db
        .select({
          meetingRoomId: meetingRoomParticipants.meetingRoomId,
          participantCount: count(),
        })
        .from(meetingRoomParticipants)
        .where(eq(meetingRoomParticipants.companyId, companyId))
        .groupBy(meetingRoomParticipants.meetingRoomId),
    ]);

    const countsByRoomId = new Map(
      participantCounts.map((row) => [row.meetingRoomId, Number(row.participantCount)]),
    );

    res.json({
      rooms: rooms.map((room) => ({
        ...room,
        participantCount: countsByRoomId.get(room.id) ?? 0,
        unreadCount: 0,
      })),
    });
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

    const nextOutcome = body.outcome === undefined ? existing.outcome : body.outcome ?? null;
    if ((body.status === "closed" || body.status === "archived") && !readOutcomeDisposition(nextOutcome)) {
      throw unprocessable(
        "Meeting rooms require an outcome.disposition before closing: no_action, decision_recorded, issues_created, blocked_by_owner, or hiring_requested",
      );
    }

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
        outcome: nextOutcome,
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

  router.patch(
    "/companies/:companyId/meeting-rooms/:roomId/decisions/:decisionId",
    validate(updateMeetingRoomDecisionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      const decisionId = req.params.decisionId as string;
      assertCompanyAccess(req, companyId);
      if (!(await getRoom(companyId, roomId))) throw notFound("Meeting room not found");

      const [decision] = await db
        .update(meetingRoomDecisions)
        .set({
          ...req.body,
          rationale: req.body.rationale === undefined ? undefined : req.body.rationale ?? null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(meetingRoomDecisions.companyId, companyId),
          eq(meetingRoomDecisions.meetingRoomId, roomId),
          eq(meetingRoomDecisions.id, decisionId),
        ))
        .returning();

      if (!decision) throw notFound("Meeting decision not found");
      res.json(decision);
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
    "/companies/:companyId/meeting-rooms/:roomId/action-items/:actionItemId/create-issue",
    validate(createIssueFromMeetingActionItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      const actionItemId = req.params.actionItemId as string;
      assertCompanyAccess(req, companyId);

      const room = await getRoom(companyId, roomId);
      if (!room) throw notFound("Meeting room not found");

      const [actionItem] = await db
        .select()
        .from(meetingRoomActionItems)
        .where(and(
          eq(meetingRoomActionItems.companyId, companyId),
          eq(meetingRoomActionItems.meetingRoomId, roomId),
          eq(meetingRoomActionItems.id, actionItemId),
        ))
        .limit(1);
      if (!actionItem) throw notFound("Meeting action item not found");
      if (actionItem.issueId) {
        throw unprocessable("Meeting action item already has a linked issue");
      }

      await assertEntityBelongsToCompany("agent", companyId, req.body.assigneeAgentId);
      const actor = getActorInfo(req);
      const description = [
        req.body.description?.trim() || `Created from meeting action item: ${actionItem.title}`,
        "",
        `Meeting: ${room.title}`,
        room.summary ? `Meeting summary: ${room.summary}` : null,
      ].filter(Boolean).join("\n");

      const issueInput = {
        title: req.body.title ?? actionItem.title,
        description,
        projectId: room.projectId,
        assigneeAgentId: req.body.assigneeAgentId ?? actionItem.assigneeAgentId,
        assigneeUserId: req.body.assigneeUserId ?? actionItem.assigneeUserId,
        status: req.body.status,
        priority: req.body.priority,
        originKind: "meeting_action_item",
        originId: actionItem.id,
        originFingerprint: room.id,
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      };

      const issue = room.issueId
        ? (await issuesSvc.createChild(room.issueId, {
            ...issueInput,
            blockParentUntilDone: false,
            actorAgentId: actor.agentId,
            actorUserId: actor.actorType === "user" ? actor.actorId : null,
          })).issue
        : await issuesSvc.create(companyId, issueInput);

      const [updatedActionItem] = await db
        .update(meetingRoomActionItems)
        .set({ issueId: issue.id, status: "in_progress", updatedAt: new Date() })
        .where(eq(meetingRoomActionItems.id, actionItem.id))
        .returning();

      await db
        .update(meetingRooms)
        .set({
          outcome: mergeOutcomeList(room.outcome ?? null, "followUpIssueIds", issue.id),
          updatedAt: new Date(),
        })
        .where(and(eq(meetingRooms.companyId, companyId), eq(meetingRooms.id, roomId)));

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "meeting_room.action_item_issue_created",
        entityType: "meeting_room",
        entityId: roomId,
        details: { actionItemId: actionItem.id, issueId: issue.id, issueIdentifier: issue.identifier },
      });

      res.status(201).json({ issue, actionItem: updatedActionItem });
    },
  );

  router.post(
    "/companies/:companyId/meeting-rooms/:roomId/hiring-requests",
    validate(requestMeetingHireSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      assertCompanyAccess(req, companyId);

      const room = await getRoom(companyId, roomId);
      if (!room) throw notFound("Meeting room not found");

      const actor = getActorInfo(req);
      const roleTitle = req.body.title?.trim() || req.body.role;
      const description = [
        `Request hire: ${roleTitle}`,
        "",
        `Division: ${req.body.division ?? room.division ?? "General"}`,
        `Reason: ${req.body.reason}`,
        req.body.skills.length > 0 ? `Skills needed: ${req.body.skills.join(", ")}` : null,
        "",
        "This is a Paperclip hiring request. Do not create an agent directly from Zero-Human; review permissions, approve the role, then create or update the agent inside Paperclip.",
        `Meeting: ${room.title}`,
      ].filter(Boolean).join("\n");

      const issueInput = {
        title: `Hiring request: ${roleTitle}`,
        description,
        projectId: room.projectId,
        assigneeAgentId: room.createdByAgentId,
        status: "todo" as const,
        priority: req.body.priority,
        originKind: "meeting_hiring_request",
        originId: room.id,
        originFingerprint: `${room.id}:${roleTitle.toLowerCase()}`,
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      };

      const issue = room.issueId
        ? (await issuesSvc.createChild(room.issueId, {
            ...issueInput,
            blockParentUntilDone: false,
            actorAgentId: actor.agentId,
            actorUserId: actor.actorType === "user" ? actor.actorId : null,
          })).issue
        : await issuesSvc.create(companyId, issueInput);

      const [actionItem] = await db
        .insert(meetingRoomActionItems)
        .values({
          companyId,
          meetingRoomId: room.id,
          issueId: issue.id,
          assigneeAgentId: room.createdByAgentId,
          title: `Review hiring request: ${roleTitle}`,
          status: "todo",
        })
        .returning();

      await db
        .update(meetingRooms)
        .set({
          outcome: mergeOutcomeList(
            mergeOutcomeList(room.outcome ?? null, "followUpIssueIds", issue.id),
            "hiringRequests",
            roleTitle,
          ),
          updatedAt: new Date(),
        })
        .where(and(eq(meetingRooms.companyId, companyId), eq(meetingRooms.id, roomId)));

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "meeting_room.hiring_requested",
        entityType: "meeting_room",
        entityId: roomId,
        details: { role: roleTitle, issueId: issue.id, issueIdentifier: issue.identifier },
      });

      res.status(201).json({ issue, actionItem });
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
