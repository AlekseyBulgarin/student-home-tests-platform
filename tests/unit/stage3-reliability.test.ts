import { describe, expect, it } from "vitest";
import { groupTelemetryEvents } from "../../supabase/functions/_shared/domain";
import { formatRemaining, serializeAnswers } from "@/lib/attempt-reliability";

describe("автосохранение", () => {
  it("даёт одинаковый снимок независимо от порядка вопросов и вариантов", () => {
    expect(serializeAnswers({ q2: ["b", "a"], q1: ["x"] })).toBe(serializeAnswers({ q1: ["x"], q2: ["a", "b"] }));
  });
});

describe("серверный таймер", () => {
  it.each([[0, "00:00"], [65, "01:05"], [3661, "01:01:01"]])("форматирует %s секунд", (seconds, expected) => {
    expect(formatRemaining(seconds as number)).toBe(expected);
  });
});

describe("журнал событий", () => {
  it("объединяет связанные blur, hidden и fullscreen exit в один интервал", () => {
    const intervals = groupTelemetryEvents([
      { type: "window_blur", client_occurred_at: "2026-11-06T10:00:00.000Z" },
      { type: "visibility_hidden", client_occurred_at: "2026-11-06T10:00:00.400Z" },
      { type: "fullscreen_exit", client_occurred_at: "2026-11-06T10:00:00.900Z" },
    ]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].types).toEqual(["window_blur", "visibility_hidden", "fullscreen_exit"]);
    expect(intervals[0].summary).not.toContain("наруш");
  });

  it("оставляет разнесённые события отдельными интервалами", () => {
    const intervals = groupTelemetryEvents([
      { type: "offline", client_occurred_at: "2026-11-06T10:00:00.000Z" },
      { type: "online", client_occurred_at: "2026-11-06T10:00:10.000Z" },
    ]);
    expect(intervals).toHaveLength(2);
  });
});
