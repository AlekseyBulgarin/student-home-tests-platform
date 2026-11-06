import { describe, expect, it } from "vitest";
import { importSchema, parseImport } from "@/lib/test-schema";

const valid = {
  schema_version: 1,
  title: "Тест",
  questions: [{ id: "q1", type: "single_choice", text: "Вопрос", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct_option_ids: ["a"], points: 1, topics: ["Тема"], explanation: "Пояснение" }],
};

describe("валидация импорта", () => {
  it("принимает корректный тест", () => expect(importSchema.safeParse(valid).success).toBe(true));
  it("отклоняет неизвестный правильный вариант", () => expect(importSchema.safeParse({ ...valid, questions: [{ ...valid.questions[0], correct_option_ids: ["x"] }] }).success).toBe(false));
  it("отклоняет несколько ключей single_choice", () => expect(importSchema.safeParse({ ...valid, questions: [{ ...valid.questions[0], correct_option_ids: ["a", "b"] }] }).success).toBe(false));
  it("показывает ошибку синтаксиса JSON", () => expect(parseImport("{").success).toBe(false));
});
