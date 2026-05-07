import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Task } from "@zh/sdk";

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

export type PersistedMemory = {
  formatVersion: 2;
  backend: "hermes-compatible-file";
  notes: Record<string, string[]>;
  outcomes: TaskOutcome[];
  skills: Record<string, SkillMemory>;
};

type LegacyPersistedMemory = Partial<Omit<PersistedMemory, "formatVersion" | "backend">> & {
  formatVersion?: number;
  backend?: string;
};

function emptyMemory(): PersistedMemory {
  return {
    formatVersion: 2,
    backend: "hermes-compatible-file",
    notes: {},
    outcomes: [],
    skills: {}
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
      skills.length ? `Learned skills:\n${skills.map((skill) => `- ${skill.skill}: ${Math.round(skill.confidence * 100)}% over ${skill.runs} runs`).join("\n")}` : ""
    ].filter(Boolean).join("\n\n") || "No prior memory for this agent yet.";
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
        formatVersion: 2,
        backend: "hermes-compatible-file",
        notes: parsed.notes ?? {},
        outcomes: parsed.outcomes ?? [],
        skills: parsed.skills ?? {}
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
