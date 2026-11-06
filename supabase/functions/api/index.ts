import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { importedTestSchema, formatZodIssues } from "../_shared/schema.ts";
import { groupTelemetryEvents } from "../_shared/domain.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Supabase-hosted functions normally expose SUPABASE_SERVICE_ROLE_KEY. The
// explicit fallback keeps deployments portable across projects using scoped
// function secrets.
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://127.0.0.1:5173,http://localhost:5173").split(",");
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

type Json = Record<string, unknown>;

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-site",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    Vary: "Origin",
  };
}

function reply(origin: string | null, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}

function fail(origin: string | null, code: string, message: string, status = 400, details?: unknown) {
  return reply(origin, { error: { code, message, details } }, status);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Bytea(token: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `\\x${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function teacherId(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

async function requireTeacher(req: Request, origin: string | null) {
  const id = await teacherId(req);
  if (!id) throw fail(origin, "unauthorized", "Войдите как преподаватель", 401);
  await service.from("teacher_profiles").upsert({ id }, { onConflict: "id", ignoreDuplicates: true });
  return id;
}

async function resolveSession(token: unknown) {
  if (typeof token !== "string" || token.length < 30 || token.length > 100) return null;
  const { data, error } = await service.rpc("server_resolve_session", { p_session_hash: await sha256Bytea(token) });
  if (error) throw error;
  return data?.[0]?.attempt_id as string | undefined;
}

async function enforceRateLimit(origin: string | null, tokenHash: string, action: "resolve" | "start", limit: number) {
  const { data, error } = await service.rpc("server_check_rate_limit", {
    p_key_hash: tokenHash, p_action: action, p_limit: limit, p_window_seconds: 60,
  });
  if (error) throw error;
  const result = data?.[0];
  if (!result?.allowed) throw fail(origin, "rate_limited", "Слишком много запросов. Повторите позже.", 429, { retry_after_seconds: result?.retry_after_seconds ?? 60 });
}

async function dashboard(teacher: string) {
  const [profileResult, studentsResult, testsResult, assignmentsResult] = await Promise.all([
    service.from("teacher_profiles").select("retention_days,review_below,reinforce_below").eq("id", teacher).single(),
    service.from("students").select("id,first_name,last_name,note,created_at").eq("teacher_id", teacher).order("created_at", { ascending: false }),
    service.from("tests").select("id,title,description,created_at,test_versions(id,version_number,status,published_at)").eq("teacher_id", teacher).order("created_at", { ascending: false }),
    service.from("assignments").select("id,student_id,version_id,deadline_at,revoked_at,created_at,attempts(id,status,score_points,max_points,score_percent,submitted_at)").eq("teacher_id", teacher).order("created_at", { ascending: false }),
  ]);
  for (const result of [profileResult, studentsResult, testsResult, assignmentsResult]) if (result.error) throw result.error;
  return { settings: profileResult.data, students: studentsResult.data, tests: testsResult.data, assignments: assignmentsResult.data };
}

async function safeAttempt(attemptId: string) {
  const { data: attempt, error } = await service.from("attempts")
    .select("id,status,started_at,deadline_at_snapshot,last_client_revision,last_event_sequence,score_points,max_points,score_percent,submitted_at,version_id,assignment_id,attempt_answers(question_id,selected_option_ids,client_revision)")
    .eq("id", attemptId).single();
  if (error) throw error;
  if (attempt.status === "in_progress" && new Date(attempt.deadline_at_snapshot).getTime() <= Date.now()) {
    await service.from("attempts").update({ status: "expired", expired_at: new Date().toISOString() }).eq("id", attemptId);
    attempt.status = "expired";
  }
  const { data: questions, error: questionsError } = await service.from("questions")
    .select("id,stable_id,type,text,points,position,question_options(stable_id,text,position),question_topics(topics(display_name))")
    .eq("version_id", attempt.version_id).order("position");
  if (questionsError) throw questionsError;
  return {
    attempt: {
      id: attempt.id, status: attempt.status, started_at: attempt.started_at,
      deadline_at: attempt.deadline_at_snapshot, revision: attempt.last_client_revision,
      score_points: attempt.score_points, max_points: attempt.max_points,
      score_percent: attempt.score_percent, submitted_at: attempt.submitted_at,
      server_time: new Date().toISOString(), last_event_sequence: attempt.last_event_sequence,
    },
    questions: (questions ?? []).map((question) => ({
      id: question.id, stable_id: question.stable_id, type: question.type, text: question.text,
      points: question.points, position: question.position,
      options: [...(question.question_options ?? [])].sort((a, b) => a.position - b.position).map(({ stable_id, text }) => ({ id: stable_id, text })),
      topics: (question.question_topics ?? []).map((link: any) => link.topics?.display_name).filter(Boolean),
    })),
    answers: Object.fromEntries((attempt.attempt_answers ?? []).map((answer: any) => [answer.question_id, answer.selected_option_ids])),
  };
}

async function buildReport(attemptId: string, reveal: boolean, includeEvents = false) {
  const { data: attempt, error } = await service.from("attempts")
    .select("id,status,started_at,submitted_at,duration_seconds,score_points,max_points,score_percent,version_id,assignment_id")
    .eq("id", attemptId).single();
  if (error) throw error;
  if (!reveal) return { revealed: false, attempt };

  const [{ data: results, error: resultError }, { data: questions, error: questionError }] = await Promise.all([
    service.from("attempt_results").select("question_id,selected_option_ids,correct_option_ids,general_explanation,option_explanations,earned_points,max_points,is_correct").eq("attempt_id", attemptId),
    service.from("questions").select("id,stable_id,text,question_options(stable_id,text),question_topics(topics(id,display_name))").eq("version_id", attempt.version_id),
  ]);
  if (resultError) throw resultError;
  if (questionError) throw questionError;
  const resultMap = new Map((results ?? []).map((result) => [result.question_id, result]));
  const topicMap = new Map<string, { id: string; name: string; earned: number; max: number; count: number }>();
  const items = (questions ?? []).map((question) => {
    const result = resultMap.get(question.id)!;
    for (const link of question.question_topics ?? []) {
      const topic = (link as any).topics;
      if (!topic) continue;
      const current = topicMap.get(topic.id) ?? { id: topic.id, name: topic.display_name, earned: 0, max: 0, count: 0 };
      current.earned += Number(result?.earned_points ?? 0); current.max += Number(result?.max_points ?? 0); current.count += 1;
      topicMap.set(topic.id, current);
    }
    const optionMap = new Map((question.question_options ?? []).map((option) => [option.stable_id, option.text]));
    return {
      question_id: question.id, stable_id: question.stable_id, text: question.text,
      selected: (result?.selected_option_ids ?? []).map((id: string) => ({ id, text: optionMap.get(id) ?? id })),
      correct: (result?.correct_option_ids ?? []).map((id: string) => ({ id, text: optionMap.get(id) ?? id })),
      explanation: result?.general_explanation ?? "", option_explanations: result?.option_explanations ?? {},
      earned_points: result?.earned_points ?? 0, max_points: result?.max_points ?? 0, is_correct: result?.is_correct ?? false,
    };
  });
  const topics = [...topicMap.values()].map((topic) => {
    const percentage = topic.max ? Math.round((topic.earned / topic.max) * 10000) / 100 : 0;
    return { ...topic, percentage, status: percentage < 60 ? "review" : percentage < 80 ? "reinforce" : "successful", limited_evidence: topic.count < 3 };
  });
  let eventIntervals: ReturnType<typeof groupTelemetryEvents> | undefined;
  if (includeEvents) {
    const { data: events, error: eventsError } = await service.from("attempt_events")
      .select("type,client_occurred_at,received_at").eq("attempt_id", attemptId).order("sequence");
    if (eventsError) throw eventsError;
    eventIntervals = groupTelemetryEvents(events ?? []);
  }
  return { revealed: true, attempt, items, topics, event_intervals: eventIntervals };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return fail(origin, "method_not_allowed", "Используйте POST", 405);
  try {
    const body = await req.json() as { action?: string; payload?: Json };
    const payload = body.payload ?? {};
    switch (body.action) {
      case "teacher.dashboard": {
        const teacher = await requireTeacher(req, origin);
        return reply(origin, await dashboard(teacher));
      }
      case "teacher.create_student": {
        const teacher = await requireTeacher(req, origin);
        const firstName = String(payload.first_name ?? "").trim();
        const lastName = String(payload.last_name ?? "").trim();
        if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) return fail(origin, "invalid_student", "Укажите имя и фамилию до 100 символов");
        const { data, error } = await service.from("students").insert({ teacher_id: teacher, first_name: firstName, last_name: lastName, note: String(payload.note ?? "").slice(0, 1000) }).select().single();
        if (error) throw error;
        return reply(origin, { student: data }, 201);
      }
      case "teacher.delete_student": {
        const teacher = await requireTeacher(req, origin);
        const { data, error } = await service.rpc("server_delete_student", { p_teacher_id: teacher, p_student_id: String(payload.student_id ?? "") });
        if (error) throw error;
        return reply(origin, data);
      }
      case "teacher.update_settings": {
        const teacher = await requireTeacher(req, origin);
        const { data, error } = await service.rpc("server_update_teacher_settings", {
          p_teacher_id: teacher,
          p_retention_days: Number(payload.retention_days),
          p_review_below: Number(payload.review_below),
          p_reinforce_below: Number(payload.reinforce_below),
        });
        if (error) throw error;
        return reply(origin, data);
      }
      case "teacher.import_test": {
        const teacher = await requireTeacher(req, origin);
        const raw = payload.test;
        const bytes = new TextEncoder().encode(JSON.stringify(raw)).byteLength;
        if (bytes > 1_000_000) return fail(origin, "import_too_large", "JSON превышает 1 МБ", 413);
        const parsed = importedTestSchema.safeParse(raw);
        if (!parsed.success) return fail(origin, "invalid_import", "Исправьте ошибки JSON", 422, formatZodIssues(parsed.error));
        const { data, error } = await service.rpc("server_import_test", { p_teacher_id: teacher, p_payload: parsed.data });
        if (error) throw error;
        return reply(origin, data, 201);
      }
      case "teacher.publish_version": {
        const teacher = await requireTeacher(req, origin);
        const { data, error } = await service.rpc("server_publish_version", { p_teacher_id: teacher, p_version_id: String(payload.version_id) });
        if (error) throw error;
        return reply(origin, data);
      }
      case "teacher.assign": {
        const teacher = await requireTeacher(req, origin);
        const studentId = String(payload.student_id ?? ""); const versionId = String(payload.version_id ?? "");
        const [{ data: student }, { data: version }] = await Promise.all([
          service.from("students").select("id").eq("id", studentId).eq("teacher_id", teacher).maybeSingle(),
          service.from("test_versions").select("id,status,tests!inner(teacher_id)").eq("id", versionId).eq("tests.teacher_id", teacher).maybeSingle(),
        ]);
        if (!student || !version || version.status !== "published") return fail(origin, "assignment_scope", "Ученик или опубликованная версия не найдены", 404);
        const token = randomToken(); const tokenHash = await sha256Bytea(token);
        const deadline = new Date(String(payload.deadline_at));
        if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) return fail(origin, "invalid_deadline", "Дедлайн должен быть в будущем");
        const expires = new Date(deadline.getTime() + 7 * 86400000);
        const { data, error } = await service.from("assignments").insert({
          teacher_id: teacher, student_id: studentId, version_id: versionId, token_hash: tokenHash,
          token_hint: token.slice(0, 6), deadline_at: deadline.toISOString(), expires_at: expires.toISOString(),
          disclosure_policy: payload.disclosure_policy ?? "after_deadline",
        }).select("id,deadline_at").single();
        if (error) throw error;
        return reply(origin, { assignment: data, token }, 201);
      }
      case "teacher.report": {
        const teacher = await requireTeacher(req, origin);
        const attemptId = String(payload.attempt_id ?? "");
        const { data: allowed } = await service.from("attempts").select("id,assignments!inner(teacher_id)").eq("id", attemptId).eq("assignments.teacher_id", teacher).maybeSingle();
        if (!allowed) return fail(origin, "not_found", "Попытка не найдена", 404);
        return reply(origin, await buildReport(attemptId, true, true));
      }
      case "student.resolve": {
        const token = String(payload.token ?? "");
        if (token.length < 30 || token.length > 100) return fail(origin, "invalid_link", "Ссылка недействительна", 404);
        const tokenHash = await sha256Bytea(token);
        await enforceRateLimit(origin, tokenHash, "resolve", 10);
        const { data, error } = await service.rpc("server_resolve_assignment", { p_token_hash: tokenHash });
        if (error) throw error;
        const assignment = data?.[0];
        if (!assignment) return fail(origin, "invalid_link", "Ссылка истекла или отозвана", 404);
        return reply(origin, { assignment: { title: assignment.test_title, student_first_name: assignment.student_first_name, student_last_name: assignment.student_last_name, deadline_at: assignment.deadline_at } });
      }
      case "student.start": {
        const token = String(payload.token ?? "");
        const firstName = String(payload.first_name ?? "").trim(); const lastName = String(payload.last_name ?? "").trim();
        if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) return fail(origin, "invalid_name", "Укажите имя и фамилию");
        if (token.length < 30 || token.length > 100) return fail(origin, "invalid_link", "Ссылка недействительна", 404);
        const tokenHash = await sha256Bytea(token);
        await enforceRateLimit(origin, tokenHash, "start", 5);
        const { data: resolved, error: resolveError } = await service.rpc("server_resolve_assignment", { p_token_hash: tokenHash });
        if (resolveError) throw resolveError;
        if (!resolved?.[0]) return fail(origin, "invalid_link", "Ссылка истекла или отозвана", 404);
        const sessionToken = randomToken();
        const { data, error } = await service.rpc("server_start_attempt", { p_assignment_id: resolved[0].id, p_first_name: firstName, p_last_name: lastName, p_session_hash: await sha256Bytea(sessionToken) });
        if (error) throw error;
        const attemptId = data?.[0]?.attempt_id;
        return reply(origin, { session_token: sessionToken, ...(await safeAttempt(attemptId)) }, 201);
      }
      case "student.attempt": {
        const attemptId = await resolveSession(payload.session_token);
        if (!attemptId) return fail(origin, "invalid_session", "Сессия истекла", 401);
        return reply(origin, await safeAttempt(attemptId));
      }
      case "student.save": {
        const attemptId = await resolveSession(payload.session_token);
        if (!attemptId) return fail(origin, "invalid_session", "Сессия истекла", 401);
        const revision = Number(payload.revision); const answers = Array.isArray(payload.answers) ? payload.answers : [];
        if (!Number.isSafeInteger(revision) || revision < 1 || answers.length > 200) return fail(origin, "invalid_save", "Некорректная ревизия или ответы");
        const { data, error } = await service.rpc("server_save_answers", { p_attempt_id: attemptId, p_revision: revision, p_answers: answers });
        if (error) throw error;
        return reply(origin, data);
      }
      case "student.events": {
        const attemptId = await resolveSession(payload.session_token);
        if (!attemptId) return fail(origin, "invalid_session", "Сессия истекла", 401);
        const events = Array.isArray(payload.events) ? payload.events : [];
        if (!events.length || events.length > 50) return fail(origin, "invalid_event_batch", "Некорректный пакет событий");
        const { data, error } = await service.rpc("server_record_events", { p_attempt_id: attemptId, p_events: events });
        if (error) throw error;
        return reply(origin, data);
      }
      case "student.submit": {
        const attemptId = await resolveSession(payload.session_token);
        if (!attemptId) return fail(origin, "invalid_session", "Сессия истекла", 401);
        const idempotencyKey = String(payload.idempotency_key ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return fail(origin, "invalid_idempotency_key", "Некорректный ключ отправки");
        const { error } = await service.rpc("server_submit_attempt", { p_attempt_id: attemptId, p_idempotency_key: idempotencyKey });
        if (error) throw error;
        const { data: assignment } = await service.from("attempts").select("assignments(disclosure_policy,deadline_at,released_at)").eq("id", attemptId).single();
        const policy = (assignment as any)?.assignments;
        const reveal = policy?.disclosure_policy === "immediate" || (policy?.disclosure_policy === "after_deadline" && new Date(policy.deadline_at).getTime() <= Date.now()) || (policy?.disclosure_policy === "teacher_released" && policy.released_at);
        return reply(origin, await buildReport(attemptId, Boolean(reveal)));
      }
      case "student.report": {
        const attemptId = await resolveSession(payload.session_token);
        if (!attemptId) return fail(origin, "invalid_session", "Сессия истекла", 401);
        const { data: assignment } = await service.from("attempts").select("assignments(disclosure_policy,deadline_at,released_at)").eq("id", attemptId).single();
        const policy = (assignment as any)?.assignments;
        const reveal = policy?.disclosure_policy === "immediate" || (policy?.disclosure_policy === "after_deadline" && new Date(policy.deadline_at).getTime() <= Date.now()) || (policy?.disclosure_policy === "teacher_released" && policy.released_at);
        return reply(origin, await buildReport(attemptId, Boolean(reveal)));
      }
      default:
        return fail(origin, "unknown_action", "Неизвестная операция", 404);
    }
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    console.error("api_request_failed", message);
    const safeCode = message.includes("deadline_passed") ? "deadline_passed" : message.includes("attempt_closed") ? "attempt_closed" : "server_error";
    return fail(origin, safeCode, safeCode === "server_error" ? "Сервер не смог выполнить операцию" : "Попытка уже завершена или время истекло", safeCode === "server_error" ? 500 : 409);
  }
});
