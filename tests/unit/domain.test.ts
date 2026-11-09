import { describe, expect, it } from "vitest";
import { asArray, gradeLabelForPercent, isExactSelection, normalizeSelection, scoreQuestion, topicStatus, validGradeThresholds } from "../../supabase/functions/_shared/domain";

describe("контракт серверных DTO", () => {
  it("нормализует to-one связь PostgREST в массив попыток", () => {
    const attempt = { id: "attempt-1", status: "submitted" };
    expect(asArray(attempt)).toEqual([attempt]);
    expect(asArray([attempt])).toEqual([attempt]);
    expect(asArray(null)).toEqual([]);
  });
});

describe("серверное оценивание", () => {
  it("нормализует порядок и повторы", () => expect(normalizeSelection(["b", "a", "b"])).toEqual(["a", "b"]));
  it("принимает точное множество независимо от порядка", () => expect(isExactSelection(["b", "a"], ["a", "b"])).toBe(true));
  it("не даёт частичный балл multiple_choice", () => expect(scoreQuestion(["a"], ["a", "b"], 3)).toBe(0));
  it("начисляет полный балл за точный ответ", () => expect(scoreQuestion(["a", "b"], ["b", "a"], 3)).toBe(3));
  it.each([[59, "review"], [60, "reinforce"], [79, "reinforce"], [80, "successful"]])("классифицирует %s%% как %s", (value, expected) => expect(topicStatus(value as number)).toBe(expected));
  it("применяет преподавательские пороги статистики тем", () => {
    expect(topicStatus(64, 65, 85)).toBe("review");
    expect(topicStatus(65, 65, 85)).toBe("reinforce");
    expect(topicStatus(85, 65, 85)).toBe("successful");
  });
});

describe("шкала оценок", () => {
  const scale = [{ label: "5", min_percent: 85 }, { label: "4", min_percent: 70 }, { label: "3", min_percent: 50 }, { label: "2", min_percent: 0 }];
  it("выбирает высший подходящий порог", () => {
    expect(gradeLabelForPercent(scale, 85)).toBe("5");
    expect(gradeLabelForPercent(scale, 84.99)).toBe("4");
    expect(gradeLabelForPercent(scale, 0)).toBe("2");
  });
  it("отклоняет неупорядоченную и неполную шкалу", () => {
    expect(validGradeThresholds([{ label: "5", min_percent: 70 }, { label: "2", min_percent: 80 }])).toBe(false);
    expect(validGradeThresholds([{ label: "5", min_percent: 70 }, { label: "2", min_percent: 1 }])).toBe(false);
  });
});
