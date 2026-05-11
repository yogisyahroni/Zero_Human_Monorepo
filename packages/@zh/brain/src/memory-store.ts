import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { MeetingSummaryMemoryPayload, Task } from "@zh/sdk";

export type SkillMemory = {
  agentId: string;
  role?: string;
  skill: string;
  runs: number;
  confidence: number;
  averageDurationMs: number;
  lastTaskId?: string;
  updatedAt: string;
};

export type TaskOutcome = {
  taskId: string;
  agentId: string;
  type: string;
  description: string;
  changedFiles: string[];
  validationPassed: boolean;
  durationMs: number;
  updatedAt: string;
};

export type MeetingMemory = MeetingSummaryMemoryPayload & {
  key: string;
  guidanceNote: string;
  storedAt: string;
};

export type MeetingGuidanceNote = {
  key: string;
  roomId: string;
  companyId: string;
  title: string;
  division?: string | null;
  participantAgentIds: string[];
  roleNeeds: string[];
  skillSignals: string[];
  note: string;
  updatedAt: string;
};

export type PersistedMemory = {
  formatVersion: 3;
  backend: "hermes-compatible-file";
  notes: Record<string, string[]>;
  outcomes: TaskOutcome[];
  skills: Record<string, SkillMemory>;
  meetings: Record<string, MeetingMemory>;
  meetingGuidance: MeetingGuidanceNote[];
};

type LegacyPersistedMemory = Partial<Omit<PersistedMemory, "formatVersion" | "backend">> & {
  formatVersion?: number;
  backend?: string;
};

function emptyMemory(): PersistedMemory {
  return {
    formatVersion: 3,
    backend: "hermes-compatible-file",
    notes: {},
    outcomes: [],
    skills: {},
    meetings: {},
    meetingGuidance: []
  };
}

function validationPassed(output: string): boolean {
  const lowered = output.toLowerCase();
  return !lowered.includes("fatal") && !lowered.includes("error:");
}

export class HermesCompatibleMemoryStore {
  private readonly memoryPath: string;
  private readonly hotNotes = new Map<string, string[]>();
  private persisted: PersistedMemory;

  constructor(memoryPath: string) {
    this.memoryPath = memoryPath;
    this.persisted = this.load();
  }

  snapshot(): PersistedMemory {
    return this.persisted;
  }

  remember(agentId: string, note: string): void {
    const notes = this.persisted.notes[agentId] ?? this.hotNotes.get(agentId) ?? [];
    notes.unshift(`${new Date().toISOString()} ${note}`);
    this.persisted.notes[agentId] = notes.slice(0, 50);
    this.hotNotes.set(agentId, notes.slice(0, 20));
    void this.save();
  }

  recentMemory(agentId: string): string {
    const notes = (this.persisted.notes[agentId] ?? []).slice(0, 5);
    const outcomes = this.persisted.outcomes.filter((outcome) => outcome.agentId === agentId).slice(0, 5);
    const skills = Object.values(this.persisted.skills)
      .filter((skill) => skill.agentId === agentId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);
    return [
      notes.length ? `Recent notes:\n${notes.map((note) => `- ${note}`).join("\n")}` : "",
      outcomes.length ? `Recent outcomes:\n${outcomes.map((outcome) => `- ${outcome.type} ${outcome.taskId}: ${outcome.validationPassed ? "passed" : "needs review"}; files=${outcome.changedFiles.join(", ") || "none"}`).join("\n")}` : "",
      skills.length ? `Learned skills:\n${skills.map((skill) => `- ${skill.skill}: ${Math.round(skill.confidence * 100)}% over ${skill.runs} runs`).join("\n")}` : "",
      this.recentMeetingGuidance({ agentId })
    ].filter(Boolean).join("\n\n") || "No prior memory for this agent yet.";
  }

  recentMeetingGuidance(input: { agentId?: string; role?: string; taskText?: string } = {}): string {
    const needles = [
      input.agentId,
      input.role,
      input.taskText
    ].filter((value): value is string => Boolean(value?.trim())).map((value) => value.toLowerCase());
    const guidance = this.persisted.meetingGuidance
      .filter((note) => {
        if (!needles.length) return true;
        if (input.agentId && note.participantAgentIds.includes(input.agentId)) return true;
        const haystack = [
          note.title,
          note.division,
          note.roleNeeds.join(" "),
          note.skillSignals.join(" "),
          note.note
        ].filter(Boolean).join(" ").toLowerCase();
        return needles.some((needle) => haystack.includes(needle));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);
    return guidance.length
      ? `Meeting guidance:\n${guidance.map((note) => `- ${note.note}`).join("\n")}`
      : "";
  }

  recordMeetingSummary(payload: MeetingSummaryMemoryPayload): {
    key: string;
    duplicate: boolean;
    guidanceNote: string;
  } {
    const key = `${payload.roomId}:${payload.version}`;
    const existing = this.persisted.meetings[key];
    if (existing) {
      return { key, duplicate: true, guidanceNote: existing.guidanceNote };
    }

    const guidanceNote = buildMeetingGuidanceNote(payload);
    const storedAt = new Date().toISOString();
    const memory: MeetingMemory = {
      ...payload,
      key,
      guidanceNote,
      storedAt
    };
    this.persisted.meetings[key] = memory;
    this.persisted.meetingGuidance.unshift({
      key,
      roomId: payload.roomId,
      companyId: payload.companyId,
      title: payload.title,
      division: payload.division ?? null,
      participantAgentIds: payload.participantAgentIds,
      roleNeeds: payload.roleNeeds,
      skillSignals: payload.skillSignals,
      note: guidanceNote,
      updatedAt: payload.updatedAt
    });
    this.persisted.meetingGuidance.splice(100);

    const hermesNotes = this.persisted.notes.hermes ?? [];
    hermesNotes.unshift(`${storedAt} Meeting memory ${payload.title}: ${guidanceNote}`);
    this.persisted.notes.hermes = hermesNotes.slice(0, 50);
    void this.save();
    return { key, duplicate: false, guidanceNote };
  }

  recordOutcome(task: Task, changedFiles: string[], validationOutput: string, durationMs: number): {
    beforeConfidence: number;
    afterConfidence: number;
    runs: number;
    skills: SkillMemory[];
  } {
    const trackedSkills = Array.from(new Set([task.type, ...(task.requiredSkills ?? [])].map((skill) => skill.trim()).filter(Boolean)));
    const passed = validationPassed(validationOutput);
    const updatedSkills = trackedSkills.map((trackedSkill) => {
      const key = `${task.agentId}:${trackedSkill}`;
      const existing = this.persisted.skills[key];
      const runs = (existing?.runs ?? 0) + 1;
      const beforeConfidence = existing?.confidence ?? 0.55;
      const afterConfidence = Number(Math.min(0.98, beforeConfidence + (passed ? 0.04 : 0.01)).toFixed(2));
      const averageDurationMs = Math.round((((existing?.averageDurationMs ?? durationMs) * (runs - 1)) + durationMs) / runs);
      const skillMemory: SkillMemory = {
        agentId: task.agentId,
        role: task.roleGuidance?.split("\n")[0]?.replace(/^Role:\s*/i, "").trim(),
        skill: trackedSkill,
        runs,
        confidence: afterConfidence,
        averageDurationMs,
        lastTaskId: task.id,
        updatedAt: new Date().toISOString()
      };
      this.persisted.skills[key] = skillMemory;
      return skillMemory;
    });
    this.persisted.outcomes.unshift({
      taskId: task.id,
      agentId: task.agentId,
      type: task.type,
      description: task.description,
      changedFiles,
      validationPassed: passed,
      durationMs,
      updatedAt: new Date().toISOString()
    });
    this.persisted.outcomes.splice(100);
    void this.save();
    const primary = updatedSkills[0];
    return {
      beforeConfidence: Number(Math.max(0.51, (primary?.confidence ?? 0.59) - (passed ? 0.04 : 0.01)).toFixed(2)),
      afterConfidence: primary?.confidence ?? 0.55,
      runs: primary?.runs ?? 0,
      skills: updatedSkills
    };
  }

  private load(): PersistedMemory {
    try {
      if (!fsSync.existsSync(this.memoryPath)) return emptyMemory();
      const parsed = JSON.parse(fsSync.readFileSync(this.memoryPath, "utf8")) as LegacyPersistedMemory;
      return {
        formatVersion: 3,
        backend: "hermes-compatible-file",
        notes: parsed.notes ?? {},
        outcomes: parsed.outcomes ?? [],
        skills: parsed.skills ?? {},
        meetings: parsed.meetings ?? {},
        meetingGuidance: parsed.meetingGuidance ?? []
      };
    } catch (error) {
      console.warn(`[brain] failed to load memory: ${(error as Error).message}`);
      return emptyMemory();
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.memoryPath), { recursive: true });
    await fs.writeFile(this.memoryPath, JSON.stringify(this.persisted, null, 2), "utf8");
  }
}

function summarizeList(label: string, values: string[]): string {
  return values.length ? `${label}: ${values.slice(0, 3).join("; ")}` : "";
}

function buildMeetingGuidanceNote(payload: MeetingSummaryMemoryPayload): string {
  return [
    `Meeting "${payload.title}" closed with ${payload.status}.`,
    payload.summary ? `Summary: ${payload.summary.slice(0, 240)}` : "",
    summarizeList("Decisions", payload.decisions),
    summarizeList("Blockers", payload.blockers),
    summarizeList("Actions", payload.actionItems),
    summarizeList("Role needs", payload.roleNeeds),
    summarizeList("Skill signals", payload.skillSignals),
    "Use this as guidance only; Paperclip remains the executor and source of truth."
  ].filter(Boolean).join(" ");
}
