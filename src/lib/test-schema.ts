import { z } from "zod";

const stableId = z.string().min(1, "Обязательный ID").max(100).regex(/^[A-Za-z0-9._-]+$/, "Допустимы латинские буквы, цифры, точка, _ и -");
const option = z.object({ id: stableId, text: z.string().trim().min(1).max(1000), explanation: z.string().max(10000).optional() });

export const importSchema = z.object({
  schema_version: z.literal(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  settings: z.object({
    time_limit_minutes: z.number().int().min(1).max(480).optional(),
    disclosure_policy: z.enum(["immediate", "after_deadline", "teacher_released"]).optional(),
  }).optional().default({}),
  questions: z.array(z.object({
    id: stableId,
    type: z.enum(["single_choice", "multiple_choice"]),
    text: z.string().trim().min(1).max(5000),
    options: z.array(option).min(2).max(20),
    correct_option_ids: z.array(stableId).min(1).max(20),
    points: z.number().positive(),
    topics: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
    explanation: z.string().max(10000),
  }).superRefine((question, ctx) => {
    const optionIds = question.options.map((item) => item.id);
    if (new Set(optionIds).size !== optionIds.length) ctx.addIssue({ code: "custom", path: ["options"], message: "ID вариантов должны быть уникальны" });
    const missing = question.correct_option_ids.filter((id) => !optionIds.includes(id));
    if (missing.length) ctx.addIssue({ code: "custom", path: ["correct_option_ids"], message: `Не найдены варианты: ${missing.join(", ")}` });
    if (question.type === "single_choice" && question.correct_option_ids.length !== 1) ctx.addIssue({ code: "custom", path: ["correct_option_ids"], message: "Нужен ровно один правильный вариант" });
  })).min(1).max(200),
}).superRefine((test, ctx) => {
  const ids = test.questions.map((question) => question.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["questions"], message: "ID вопросов должны быть уникальны" });
});

export type ImportTest = z.infer<typeof importSchema>;

export function parseImport(text: string) {
  if (new TextEncoder().encode(text).byteLength > 1_000_000) return { success: false as const, errors: ["Файл превышает 1 МБ"] };
  try {
    const result = importSchema.safeParse(JSON.parse(text));
    if (!result.success) return { success: false as const, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "JSON"}: ${issue.message}`) };
    return { success: true as const, data: result.data };
  } catch {
    return { success: false as const, errors: ["Некорректный JSON"] };
  }
}
