import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HermesCompatibleMemoryStore } from "./memory-store.js";

describe("HermesCompatibleMemoryStore meeting memory", () => {
  it("stores meeting guidance and dedupes by room/version", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "zh-meeting-memory-"));
    const store = new HermesCompatibleMemoryStore(path.join(dir, "memory.json"));
    const payload = {
      roomId: "room_1",
      companyId: "company_1",
      version: "2026-05-11T00:00:00.000Z",
      title: "Android delivery sync",
      division: "engineering",
      status: "closed" as const,
      summary: "The team agreed Android delivery needs repo analysis before implementation.",
      decisions: ["Use the synced LANCAR repository as the source of truth."],
      blockers: ["Android build environment is not verified."],
      actionItems: ["CTO confirms the workspace path."],
      roleNeeds: ["Android developer"],
      skillSignals: ["android", "repo-analysis"],
      participantAgentIds: ["cto"],
      projectId: "project_1",
      issueId: "issue_1",
      outcome: { disposition: "decision_recorded" },
      closedAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
    };

    const first = store.recordMeetingSummary(payload);
    const second = store.recordMeetingSummary(payload);
    const snapshot = store.snapshot();

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(Object.keys(snapshot.meetings)).toHaveLength(1);
    expect(snapshot.meetingGuidance).toHaveLength(1);
    expect(store.recentMeetingGuidance({ agentId: "cto" })).toContain("Android delivery sync");
    expect(store.recentMeetingGuidance({ role: "android" })).toContain("Android developer");
  });
});
