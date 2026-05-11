import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  CircleDot,
  FileText,
  Link as LinkIcon,
  MessagesSquare,
  Search,
  Users,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "@/lib/router";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { meetingRoomsApi, type MeetingRoom, type MeetingRoomStatus } from "../api/meetingRooms";
import { projectsApi } from "../api/projects";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime, formatDateTime } from "../lib/utils";
import type { Agent, Issue, Project } from "@paperclipai/shared";

const STATUS_OPTIONS: Array<MeetingRoomStatus | "all"> = [
  "all",
  "draft",
  "active",
  "summarizing",
  "closed",
  "archived",
];

function roomStatusClass(status: string) {
  if (status === "active") return "border-blue-500/40 bg-blue-500/10 text-blue-500";
  if (status === "summarizing") return "border-amber-500/40 bg-amber-500/10 text-amber-500";
  if (status === "closed") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
  if (status === "archived") return "border-muted-foreground/30 bg-muted/50 text-muted-foreground";
  return "border-border bg-muted/40 text-muted-foreground";
}

function nameForAgent(agents: Agent[] | undefined, id: string | null) {
  if (!id) return null;
  return agents?.find((agent) => agent.id === id)?.name ?? id.slice(0, 8);
}

function issueLabel(issues: Issue[] | undefined, id: string | null) {
  if (!id) return null;
  const issue = issues?.find((candidate) => candidate.id === id);
  if (!issue) return id.slice(0, 8);
  return `${issue.identifier ?? issue.id.slice(0, 8)} · ${issue.title}`;
}

function projectName(projects: Project[] | undefined, id: string | null) {
  if (!id) return null;
  return projects?.find((project) => project.id === id)?.name ?? id.slice(0, 8);
}

function useMeetingRoomContext(companyId: string | null | undefined) {
  const { data: agents = [] } = useQuery({
    queryKey: companyId ? queryKeys.agents.list(companyId) : ["agents", "pending"],
    queryFn: () => agentsApi.list(companyId!),
    enabled: !!companyId,
  });
  const { data: projects = [] } = useQuery({
    queryKey: companyId ? queryKeys.projects.list(companyId) : ["projects", "pending"],
    queryFn: () => projectsApi.list(companyId!),
    enabled: !!companyId,
  });
  const { data: issues = [] } = useQuery({
    queryKey: companyId ? queryKeys.issues.list(companyId) : ["issues", "pending"],
    queryFn: () => issuesApi.list(companyId!, { limit: 500 }),
    enabled: !!companyId,
  });

  return { agents, projects, issues };
}

export function MeetingRooms() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams] = useSearchParams();
  const issueIdFromUrl = searchParams.get("issue") ?? "";
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [division, setDivision] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [issueFilter, setIssueFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState("");
  const serverFilters = useMemo(
    () => ({
      ...(status !== "all" ? { status } : {}),
      ...(division.trim() ? { division: division.trim() } : {}),
      ...(issueIdFromUrl ? { issueId: issueIdFromUrl } : {}),
    }),
    [division, issueIdFromUrl, status],
  );

  useEffect(() => {
    setBreadcrumbs([{ label: "Meetings" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.meetingRooms.list(selectedCompanyId, serverFilters) : ["meeting-rooms", "pending"],
    queryFn: () => meetingRoomsApi.list(selectedCompanyId!, serverFilters),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const { agents, projects, issues } = useMeetingRoomContext(selectedCompanyId);

  const rooms = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const normalizedAgent = agentFilter.trim().toLowerCase();
    const normalizedIssue = issueFilter.trim().toLowerCase();
    const normalizedDate = dateFilter.trim();

    return (data?.rooms ?? []).filter((room) => {
      const issue = issueLabel(issues, room.issueId)?.toLowerCase() ?? "";
      const project = projectName(projects, room.projectId)?.toLowerCase() ?? "";
      const haystack = [
        room.title,
        room.division ?? "",
        room.purpose ?? "",
        issue,
        project,
      ].join(" ").toLowerCase();
      if (normalizedSearch && !haystack.includes(normalizedSearch)) return false;
      if (normalizedIssue && !issue.includes(normalizedIssue)) return false;
      if (normalizedDate && !room.updatedAt.startsWith(normalizedDate) && !room.createdAt.startsWith(normalizedDate)) {
        return false;
      }
      if (normalizedAgent) {
        const createdBy = nameForAgent(agents, room.createdByAgentId)?.toLowerCase() ?? "";
        if (!createdBy.includes(normalizedAgent)) return false;
      }
      return true;
    });
  }, [agentFilter, data?.rooms, dateFilter, issues, projects, search, agents, issueFilter]);

  if (!selectedCompanyId) {
    return <EmptyState icon={MessagesSquare} message="Select a company to view meeting rooms." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meeting rooms</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Division rooms, issue-linked discussions, decisions, and follow-up actions.
            {issueIdFromUrl ? " Showing rooms linked to the selected issue." : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-6">
        <div className="relative md:col-span-2">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search rooms"
            className="pl-8"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as (typeof STATUS_OPTIONS)[number])}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>{option === "all" ? "All statuses" : option}</option>
          ))}
        </select>
        <Input value={division} onChange={(event) => setDivision(event.target.value)} placeholder="Division" />
        <Input value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} placeholder="Agent" />
        <Input value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)} placeholder="Issue" />
        <Input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error instanceof Error ? error.message : "Unable to load meeting rooms."}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-lg border border-border bg-muted/30" />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          message="No meeting rooms match the current filters. Create one from an issue or agent workflow when a division needs shared context."
        />
      ) : (
        <div className="space-y-2">
          {rooms.map((room) => (
            <MeetingRoomListItem
              key={room.id}
              room={room}
              issueLabel={issueLabel(issues, room.issueId)}
              projectName={projectName(projects, room.projectId)}
              createdBy={nameForAgent(agents, room.createdByAgentId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingRoomListItem({
  room,
  issueLabel,
  projectName,
  createdBy,
}: {
  room: MeetingRoom;
  issueLabel: string | null;
  projectName: string | null;
  createdBy: string | null;
}) {
  return (
    <Link
      to={`/meetings/${room.id}`}
      className="block rounded-lg border border-border bg-card p-4 text-inherit no-underline transition-colors hover:bg-accent/30"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{room.title}</h2>
            <Badge variant="outline" className={cn("capitalize", roomStatusClass(room.status))}>
              {room.status}
            </Badge>
            {(room.unreadCount ?? 0) > 0 ? (
              <Badge>{room.unreadCount} unread</Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {room.division ?? "General"}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {relativeTime(room.updatedAt)}
            </span>
            <span>{room.participantCount ?? 0} participants</span>
            {createdBy ? <span>Created by {createdBy}</span> : null}
          </div>
          {room.purpose ? <p className="line-clamp-2 text-sm text-muted-foreground">{room.purpose}</p> : null}
        </div>
        <div className="min-w-0 space-y-1 text-xs text-muted-foreground md:w-72">
          {issueLabel ? (
            <div className="truncate">
              <span className="text-foreground">Issue:</span> {issueLabel}
            </div>
          ) : null}
          {projectName ? (
            <div className="truncate">
              <span className="text-foreground">Project:</span> {projectName}
            </div>
          ) : null}
          <div>{room.agenda.length} agenda items</div>
        </div>
      </div>
    </Link>
  );
}

export function MeetingRoomDetail() {
  const { roomId } = useParams<{ roomId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { agents, projects, issues } = useMeetingRoomContext(selectedCompanyId);

  const { data, isLoading, error } = useQuery({
    queryKey: selectedCompanyId && roomId ? queryKeys.meetingRooms.detail(selectedCompanyId, roomId) : ["meeting-room", "pending"],
    queryFn: () => meetingRoomsApi.get(selectedCompanyId!, roomId!),
    enabled: !!selectedCompanyId && !!roomId,
    refetchInterval: 10_000,
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Meetings", href: "/meetings" },
      { label: data?.room.title ?? "Meeting room" },
    ]);
  }, [data?.room.title, setBreadcrumbs]);

  if (!selectedCompanyId) {
    return <EmptyState icon={MessagesSquare} message="Select a company to view this meeting room." />;
  }

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-muted/30" />;
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={MessagesSquare}
        message={error instanceof Error ? error.message : "Meeting room could not be loaded."}
      />
    );
  }

  const { room, participants, messages, decisions, actionItems, artifactReferences } = data;
  const linkedIssue = issueLabel(issues, room.issueId);
  const linkedProject = projectName(projects, room.projectId);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{room.title}</h1>
              <Badge variant="outline" className={cn("capitalize", roomStatusClass(room.status))}>
                {room.status}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {room.purpose ?? "No purpose recorded yet."}
            </p>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground md:text-right">
            <div>Updated {relativeTime(room.updatedAt)}</div>
            {room.startedAt ? <div>Started {formatDateTime(room.startedAt)}</div> : null}
            {room.closedAt ? <div>Closed {formatDateTime(room.closedAt)}</div> : null}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{room.division ?? "General"}</Badge>
          {linkedIssue ? (
            <Badge variant="outline" className="max-w-full">
              <LinkIcon className="h-3 w-3" />
              <span className="truncate">{linkedIssue}</span>
            </Badge>
          ) : null}
          {linkedProject ? <Badge variant="outline">{linkedProject}</Badge> : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Section title="Conversation transcript" icon={MessagesSquare}>
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No messages have been recorded in this room yet.
              </p>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => {
                  const author = nameForAgent(agents, message.authorAgentId)
                    ?? message.authorUserId
                    ?? message.authorType;
                  return (
                    <div key={message.id} className="rounded-lg border border-border bg-background p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="capitalize">{message.authorType}</Badge>
                        <span className="font-medium text-foreground">{author}</span>
                        <span>{formatDateTime(message.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Outcomes" icon={CheckCircle2}>
            {room.summary ? <p className="text-sm leading-6">{room.summary}</p> : null}
            {decisions.length === 0 && actionItems.length === 0 && !room.summary ? (
              <p className="text-sm text-muted-foreground">No decisions or action items recorded yet.</p>
            ) : null}
            {decisions.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decisions</h3>
                {decisions.map((decision) => (
                  <div key={decision.id} className="rounded-md border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{decision.title}</span>
                      <Badge variant="outline">{decision.status}</Badge>
                    </div>
                    {decision.rationale ? <p className="mt-1 text-xs text-muted-foreground">{decision.rationale}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {actionItems.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action items</h3>
                {actionItems.map((item) => (
                  <div key={item.id} className="rounded-md border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{item.title}</span>
                      <Badge variant="outline">{item.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {nameForAgent(agents, item.assigneeAgentId) ?? "Unassigned"}
                      {item.dueAt ? ` · due ${formatDateTime(item.dueAt)}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </Section>

          <Section title="Participants" icon={Users}>
            {participants.length === 0 ? (
              <p className="text-sm text-muted-foreground">No participants are attached yet.</p>
            ) : (
              <div className="space-y-2">
                {participants.map((participant) => (
                  <div key={participant.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {nameForAgent(agents, participant.agentId) ?? participant.userId ?? "Unknown participant"}
                      </div>
                      <div className="text-xs text-muted-foreground">{participant.role}</div>
                    </div>
                    <Badge variant="outline">{participant.attendanceStatus}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Agenda" icon={CircleDot}>
            {room.agenda.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agenda items recorded.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {room.agenda.map((item, index) => (
                  <li key={`${item}-${index}`} className="flex gap-2">
                    <span className="text-muted-foreground">{index + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="Artifacts" icon={FileText}>
            {artifactReferences.length === 0 ? (
              <p className="text-sm text-muted-foreground">No linked artifacts yet.</p>
            ) : (
              <div className="space-y-2">
                {artifactReferences.map((artifact) => (
                  <a
                    key={artifact.id}
                    href={artifact.url ?? undefined}
                    target={artifact.url ? "_blank" : undefined}
                    rel="noreferrer"
                    className="block rounded-md border border-border p-2 text-sm text-inherit no-underline hover:bg-accent/30"
                  >
                    <div className="font-medium">{artifact.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {artifact.provider} · {artifact.artifactType}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof MessagesSquare;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function IssueMeetingRoomsPanel({
  companyId,
  issueId,
}: {
  companyId: string;
  issueId: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.meetingRooms.issueLinks(companyId, issueId),
    queryFn: () => meetingRoomsApi.list(companyId, { issueId }),
    enabled: !!companyId && !!issueId,
    refetchInterval: 15_000,
  });

  const rooms = data?.rooms ?? [];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Meetings</h3>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/meetings?issue=${encodeURIComponent(issueId)}`}>Open rooms</Link>
        </Button>
      </div>
      {isLoading ? (
        <div className="h-12 animate-pulse rounded-md bg-muted/30" />
      ) : rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No meeting rooms are linked to this issue yet.
        </p>
      ) : (
        <div className="space-y-2">
          {rooms.slice(0, 4).map((room) => (
            <Link
              key={room.id}
              to={`/meetings/${room.id}`}
              className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm text-inherit no-underline hover:bg-accent/30"
            >
              <span className="min-w-0 truncate font-medium">{room.title}</span>
              <Badge variant="outline" className={cn("capitalize", roomStatusClass(room.status))}>
                {room.status}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
