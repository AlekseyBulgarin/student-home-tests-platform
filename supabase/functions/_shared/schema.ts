import { z } from "npm:zod@4.1.12";

const stableId = z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/);
const optionSchema = z.object({
  id: stableId,
  text: z.string().trim().min(1).max(1000),
  explanation: z.string().max(10000).optional(),
});

const questionSchema = z.object({
  id: stableId,
  type: z.enum(["single_choice", "multiple_choice"]),
  text: z.string().trim().min(1).max(5000),
  options: z.array(optionSchema).min(2).max(20),
  correct_option_ids: z.array(stableId).min(1).max(20),
  points: z.number().positive().max(10000),
  topics: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  explanation: z.string().max(10000),
}).superRefine((question, ctx) => {
  const optionIds = question.options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "ID вариантов должны быть уникальны" });
  }
  const missing = question.correct_option_ids.filter((id) => !optionIds.includes(id));
  if (missing.length) {
    ctx.addIssue({ code: "custom", path: ["correct_option_ids"], message: `Неизвестные правильные варианты: ${missing.join(", ")}` });
  }
  if (question.type === "single_choice" && question.correct_option_ids.length !== 1) {
    ctx.addIssue({ code: "custom", path: ["correct_option_ids"], message: "single_choice требует ровно один правильный вариант" });
  }
  if (new Set(question.correct_option_ids).size !== question.correct_option_ids.length) {
    ctx.addIssue({ code: "custom", path: ["correct_option_ids"], message: "Правильные варианты не должны повторяться" });
  }
  if (new Set(question.topics.map((topic) => topic.toLocaleLowerCase("ru"))).size !== question.topics.length) {
    ctx.addIssue({ code: "custom", path: ["topics"], message: "Темы вопроса не должны повторяться" });
  }
});

export const importedTestSchema = z.object({
  schema_version: z.literal(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  settings: z.object({
    time_limit_minutes: z.number().int().min(1).max(480).optional(),
    disclosure_policy: z.enum(["immediate", "after_deadline", "teacher_released"]).optional(),
  }).optional().default({}),
  questions: z.array(questionSchema).min(1).max(200),
}).superRefine((test, ctx) => {
  const ids = test.questions.map((question) => question.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", path: ["questions"], message: "ID вопросов должны быть уникальны" });
  }
});

export function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message }));
}
