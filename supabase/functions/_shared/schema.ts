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

export const importedTestPayloadSchema = z.object({ test: importedTestSchema }).strict();

export function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message }));
}

const uuid = z.uuid();
const isoDateTime = z.iso.datetime({ offset: true });
const sessionToken = z.string().min(30).max(100);

export const emptyPayloadSchema = z.object({}).strict();

export const createStudentSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  note: z.string().max(1000).optional().default(""),
}).strict();

export const studentIdSchema = z.object({ student_id: uuid }).strict();
export const versionIdSchema = z.object({ version_id: uuid }).strict();
export const assignmentIdSchema = z.object({ assignment_id: uuid }).strict();

export const teacherSettingsSchema = z.object({
  retention_days: z.number().int().min(1).max(3650),
  review_below: z.number().int().min(1).max(99),
  reinforce_below: z.number().int().min(2).max(100),
}).strict().refine(({ review_below, reinforce_below }) => review_below < reinforce_below, {
  path: ["reinforce_below"],
  message: "Порог закрепления должен быть выше порога разбора",
});

export const assignmentSchema = z.object({
  student_id: uuid,
  version_id: uuid,
  deadline_at: isoDateTime,
  disclosure_policy: z.enum(["immediate", "after_deadline", "teacher_released"]).optional().default("after_deadline"),
}).strict();

export const studentResolveSchema = z.object({ token: sessionToken }).strict();
export const studentStartSchema = z.object({
  token: sessionToken,
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
}).strict();
export const studentSessionSchema = z.object({ session_token: sessionToken }).strict();

const savedAnswerSchema = z.object({
  question_id: uuid,
  selected_option_ids: z.array(stableId).max(20),
}).strict();

export const saveAnswersSchema = z.object({
  session_token: sessionToken,
  revision: z.number().int().positive().safe(),
  answers: z.array(savedAnswerSchema).max(200),
}).strict();

const eventSchema = z.object({
  event_id: uuid,
  sequence: z.number().int().positive().safe(),
  type: z.enum(["fullscreen_enter", "fullscreen_exit", "visibility_visible", "visibility_hidden", "window_focus", "window_blur", "copy_attempt", "online", "offline"]),
  client_occurred_at: isoDateTime,
  payload: z.record(z.string(), z.unknown()).optional().default({}),
}).strict();

export const attemptEventsSchema = z.object({
  session_token: sessionToken,
  events: z.array(eventSchema).min(1).max(50),
}).strict();

export const submitAttemptSchema = z.object({
  session_token: sessionToken,
  idempotency_key: uuid,
}).strict();

export const operationFiltersSchema = z.object({
  search: z.string().trim().max(200).optional().default(""),
  test_version_id: uuid.optional(),
  status: z.enum(["not_started", "in_progress", "submitted", "expired"]).optional(),
}).strict();

export const extendAttemptSchema = z.object({
  attempt_id: uuid,
  deadline_at: isoDateTime,
}).strict();

export const extendTestAttemptsSchema = z.object({
  version_id: uuid,
  deadline_at: isoDateTime,
}).strict();

export const attemptActionSchema = z.object({ attempt_id: uuid }).strict();

const gradeThresholdSchema = z.object({
  label: z.string().trim().min(1).max(20),
  min_percent: z.number().finite().min(0).max(100),
}).strict();

export const gradeScaleSchema = z.object({
  thresholds: z.array(gradeThresholdSchema).min(2).max(10),
}).strict().superRefine(({ thresholds }, ctx) => {
  const labels = new Set<string>();
  for (let index = 0; index < thresholds.length; index += 1) {
    const threshold = thresholds[index];
    if (labels.has(threshold.label)) ctx.addIssue({ code: "custom", path: ["thresholds", index, "label"], message: "Названия оценок не должны повторяться" });
    labels.add(threshold.label);
    if (index > 0 && threshold.min_percent >= thresholds[index - 1].min_percent) {
      ctx.addIssue({ code: "custom", path: ["thresholds", index, "min_percent"], message: "Пороги должны строго убывать" });
    }
  }
  if (thresholds.at(-1)?.min_percent !== 0) {
    ctx.addIssue({ code: "custom", path: ["thresholds", thresholds.length - 1, "min_percent"], message: "Последний порог должен быть 0" });
  }
});
