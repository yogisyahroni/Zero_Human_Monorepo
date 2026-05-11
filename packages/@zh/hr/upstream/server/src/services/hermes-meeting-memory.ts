import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  meetingRoomActionItems,
  meetingRoomDecisions,
  meetingRoomParticipants,
  meetingRooms,
} from "@paperclipai/db";

type MeetingSummaryPayload = {
  roomId: string;
  companyId: string;
  version: string;
  title: string;
  division?: string | null;
  status: "closed" | "archived";
  summary?: string | null;
  decisions: string[];
  blockers: string[];
  actionItems: string[];
  roleNeeds: string[];
  skillSignals: string[];
  participantAgentIds: string[];
  projectId?: string | null;
  issueId?: string | null;
  outcome?: Record<string, unknown> | null;
  closedAt?: string | null;
  updatedAt: string;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))).slice(0, 50);
}

function outcomeStrings(outcome: Record<string, unknown> | null, key: string): string[] {
  const value = outcome?.[key];
  return Array.isArray(value) ? uniqueStrings(value.map((item) => String(item))) : [];
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function adapterUrl(): string | null {
  const value = process.env.ZH_BRAIN_ADAPTER_URL ?? process.env.ZERO_HUMAN_BRAIN_URL ?? process.env.ZH_BRAIN_URL;
  return value?.trim().replace(/\/$/, "") || null;
}

function derivedSkillSignals(...texts: Array<string | null | undefined>): string[] {
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  const signals: string[] = [];
  const rules: Array<[RegExp, string]> = [
    [/\bandroid|kotlin|compose\b/, "android"],
    [/\bapi|backend|database|server|auth\b/, "backend"],
    [/\bfrontend|react|ui|css|browser\b/, "frontend"],
    [/\bqa|test|e2e|regression\b/, "qa"],
    [/\bdeploy|docker|ci|github action|staging\b/, "devops"],
    [/\bdesign|ux|brand\b/, "design"],
    [/\bmarketing|growth|campaign|seo\b/, "marketing"],
    [/\bfinance|budget|cost\b/, "finance"],
    [/\bsupport|customer|docs\b/, "support"],
    [/\bmcp|tool|integration\b/, "mcp"],
    [/\brepo|repository|git\b/, "repo-analysis"],
  ];
  for (const [pattern, signal] of rules) {
    if (pattern.test(text)) signals.push(signal);
  }
  return signals;
}

export async function publishMeetingSummaryToHermes(db: Db, input: {
  companyId: string;
  roomId: string;
}): Promise<{ sent: boolean; skipped?: string }> {
  const baseUrl = adapterUrl();
  if (!baseUrl) return { sent: false, skipped: "ZH_BRAIN_ADAPTER_URL is not configured" };

  const [room] = await db
    .select()
    .from(meetingRooms)
    .where(and(eq(meetingRooms.companyId, input.companyId), eq(meetingRooms.id, input.roomId)))
    .limit(1);

  if (!room || (room.status !== "closed" && room.status !== "archived")) {
    return { sent: false, skipped: "meeting room is not closed or archived" };
  }

  const outcome = room.outcome && typeof room.outcome === "object" ? room.outcome as Record<string, unknown> : null;
  const [participants, decisions, actionItems] = await Promise.all([
    db.select().from(meetingRoomParticipants).where(eq(meetingRoomParticipants.meetingRoomId, room.id)),
    db.select().from(meetingRoomDecisions).where(eq(meetingRoomDecisions.meetingRoomId, room.id)),
    db.select().from(meetingRoomActionItems).where(eq(meetingRoomActionItems.meetingRoomId, room.id)),
  ]);

  const version = isoDate(room.updatedAt) ?? new Date().toISOString();
  const payload: MeetingSummaryPayload = {
    roomId: room.id,
    companyId: room.companyId,
    version,
    title: room.title,
    division: room.division,
    status: room.status,
    summary: room.summary,
    decisions: uniqueStrings([
      ...decisions.filter((decision) => decision.status === "accepted").map((decision) => decision.title),
      ...outcomeStrings(outcome, "decisions"),
    ]),
    blockers: outcomeStrings(outcome, "blockers"),
    actionItems: uniqueStrings([
      ...actionItems.map((item) => item.title),
      ...outcomeStrings(outcome, "actionItems"),
    ]),
    roleNeeds: uniqueStrings([
      ...outcomeStrings(outcome, "hiringRequests"),
      ...outcomeStrings(outcome, "owners"),
    ]),
    skillSignals: uniqueStrings([
      ...outcomeStrings(outcome, "skillSignals"),
      ...outcomeStrings(outcome, "skills"),
      ...derivedSkillSignals(room.title, room.division, room.summary, room.agenda.join(" ")),
    ]),
    participantAgentIds: uniqueStrings(participants.map((participant) => participant.agentId)),
    projectId: room.projectId,
    issueId: room.issueId,
    outcome,
    closedAt: isoDate(room.closedAt),
    updatedAt: version,
  };

  try {
    const response = await fetch(`${baseUrl}/api/memory/meeting-summary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      console.warn(`[paperclip] Hermes meeting memory sync failed: HTTP ${response.status}`);
      return { sent: false, skipped: `Hermes bridge returned HTTP ${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    console.warn(`[paperclip] Hermes meeting memory sync skipped: ${(error as Error).message}`);
    return { sent: false, skipped: (error as Error).message };
  }
}
