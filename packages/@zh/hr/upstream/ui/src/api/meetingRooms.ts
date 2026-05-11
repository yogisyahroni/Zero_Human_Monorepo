import { api } from "./client";

export type MeetingRoomStatus = "draft" | "active" | "summarizing" | "closed" | "archived";
export type MeetingRoomDisposition =
  | "no_action"
  | "decision_recorded"
  | "issues_created"
  | "blocked_by_owner"
  | "hiring_requested";

export interface MeetingRoom {
  id: string;
  companyId: string;
  projectId: string | null;
  issueId: string | null;
  title: string;
  division: string | null;
  status: MeetingRoomStatus;
  purpose: string | null;
  agenda: string[];
  summary: string | null;
  outcome: Record<string, unknown> | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  startedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  participantCount?: number;
  unreadCount?: number;
}

export interface MeetingRoomParticipant {
  id: string;
  companyId: string;
  meetingRoomId: string;
  agentId: string | null;
  userId: string | null;
  role: string;
  attendanceStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingRoomMessage {
  id: string;
  companyId: string;
  meetingRoomId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  authorType: "agent" | "user" | "system" | string;
  body: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface MeetingRoomDecision {
  id: string;
  companyId: string;
  meetingRoomId: string;
  title: string;
  rationale: string | null;
  status: string;
  decidedByAgentId: string | null;
  decidedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingRoomActionItem {
  id: string;
  companyId: string;
  meetingRoomId: string;
  issueId: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  title: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingRoomArtifactReference {
  id: string;
  companyId: string;
  meetingRoomId: string;
  provider: string;
  artifactType: string;
  artifactId: string | null;
  title: string;
  url: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface MeetingRoomDetail {
  room: MeetingRoom;
  participants: MeetingRoomParticipant[];
  messages: MeetingRoomMessage[];
  decisions: MeetingRoomDecision[];
  actionItems: MeetingRoomActionItem[];
  artifactReferences: MeetingRoomArtifactReference[];
}

export interface MeetingRoomFilters {
  status?: string;
  division?: string;
  issueId?: string;
  projectId?: string;
}

function roomQuery(filters?: MeetingRoomFilters) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.division) params.set("division", filters.division);
  if (filters?.issueId) params.set("issueId", filters.issueId);
  if (filters?.projectId) params.set("projectId", filters.projectId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const meetingRoomsApi = {
  list: (companyId: string, filters?: MeetingRoomFilters) =>
    api.get<{ rooms: MeetingRoom[] }>(`/companies/${companyId}/meeting-rooms${roomQuery(filters)}`),
  get: (companyId: string, roomId: string) =>
    api.get<MeetingRoomDetail>(`/companies/${companyId}/meeting-rooms/${roomId}`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<MeetingRoom>(`/companies/${companyId}/meeting-rooms`, data),
  update: (companyId: string, roomId: string, data: Record<string, unknown>) =>
    api.patch<MeetingRoom>(`/companies/${companyId}/meeting-rooms/${roomId}`, data),
  addMessage: (companyId: string, roomId: string, data: Record<string, unknown>) =>
    api.post<MeetingRoomMessage>(`/companies/${companyId}/meeting-rooms/${roomId}/messages`, data),
  addDecision: (companyId: string, roomId: string, data: Record<string, unknown>) =>
    api.post<MeetingRoomDecision>(`/companies/${companyId}/meeting-rooms/${roomId}/decisions`, data),
  updateDecision: (companyId: string, roomId: string, decisionId: string, data: Record<string, unknown>) =>
    api.patch<MeetingRoomDecision>(`/companies/${companyId}/meeting-rooms/${roomId}/decisions/${decisionId}`, data),
  addActionItem: (companyId: string, roomId: string, data: Record<string, unknown>) =>
    api.post<MeetingRoomActionItem>(`/companies/${companyId}/meeting-rooms/${roomId}/action-items`, data),
  createIssueFromActionItem: (companyId: string, roomId: string, actionItemId: string, data: Record<string, unknown>) =>
    api.post<{ issue: unknown; actionItem: MeetingRoomActionItem }>(
      `/companies/${companyId}/meeting-rooms/${roomId}/action-items/${actionItemId}/create-issue`,
      data,
    ),
  requestHire: (companyId: string, roomId: string, data: Record<string, unknown>) =>
    api.post<{ issue: unknown; actionItem: MeetingRoomActionItem }>(
      `/companies/${companyId}/meeting-rooms/${roomId}/hiring-requests`,
      data,
    ),
};
