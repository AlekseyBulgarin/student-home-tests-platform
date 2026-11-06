import { describe, expect, it } from "vitest";
import { isExactSelection, normalizeSelection, scoreQuestion, topicStatus } from "../../supabase/functions/_shared/domain";

describe("серверное оценивание", () => {
  it("нормализует порядок и повторы", () => expect(normalizeSelection(["b", "a", "b"])).toEqual(["a", "b"]));
  it("принимает точное множество независимо от порядка", () => expect(isExactSelection(["b", "a"], ["a", "b"])).toBe(true));
  it("не даёт частичный балл multiple_choice", () => expect(scoreQuestion(["a"], ["a", "b"], 3)).toBe(0));
  it("начисляет полный балл за точный ответ", () => expect(scoreQuestion(["a", "b"], ["b", "a"], 3)).toBe(3));
  it.each([[59, "review"], [60, "reinforce"], [79, "reinforce"], [80, "successful"]])("классифицирует %s%% как %s", (value, expected) => expect(topicStatus(value as number)).toBe(expected));
});
