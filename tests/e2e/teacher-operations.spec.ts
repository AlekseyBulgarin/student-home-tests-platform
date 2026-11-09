import { expect, test } from "@playwright/test";

const apiUrl = "http://127.0.0.1:54321/functions/v1/api";
const versionId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";

test("подтверждает опасное действие преподавателя и не отправляет его до подтверждения", async ({ page, context }) => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  await page.addInitScript(({ expiresAt }) => localStorage.setItem("sb-127-auth-token", JSON.stringify({
    access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: expiresAt,
    user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "teacher@example.test", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} },
  })), { expiresAt });
  let forceRequests = 0;
  const dashboard = {
    settings: { retention_days: 365, review_below: 60, reinforce_below: 80 }, grade_scale: { thresholds: [{ label: "5", min_percent: 85 }, { label: "2", min_percent: 0 }], updated_at: null },
    students: [], tests: [{ id: "44444444-4444-4444-8444-444444444444", title: "Алгебра", description: "", created_at: new Date().toISOString(), test_versions: [{ id: versionId, version_number: 1, status: "published", published_at: new Date().toISOString(), title_snapshot: "Алгебра" }] }], assignments: [],
    operation_rows: [{ assignment_id: "55555555-5555-4555-8555-555555555555", attempt_id: attemptId, student_id: "66666666-6666-4666-8666-666666666666", student_name: "Петров Иван", version_id: versionId, test_title: "Алгебра", version_number: 1, status: "in_progress", answers_count: 1, questions_count: 2, score_points: null, max_points: null, score_percent: null, grade_label: null, completion_reason: null, telemetry_count: 1, deadline_at: new Date(Date.now() + 86_400_000).toISOString(), submitted_at: null }],
  };
  await context.route(apiUrl, async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    if (body.action === "teacher.dashboard") return route.fulfill({ json: dashboard });
    if (body.action === "teacher.force_finish_attempt") { forceRequests += 1; return route.fulfill({ json: { attempt_id: attemptId, completion_reason: "teacher" } }); }
    return route.fulfill({ json: {} });
  });

  await page.goto("/teacher/dashboard");
  await expect(page.getByRole("heading", { name: "Кабинет преподавателя" })).toBeVisible();
  await expect(page.getByText("Петров Иван")).toBeVisible();
  await page.getByRole("button", { name: "Завершить" }).click();
  await expect(page.getByText(/Попытка будет немедленно завершена/)).toBeVisible();
  expect(forceRequests).toBe(0);
  await page.getByRole("button", { name: "Подтвердить" }).click();
  await expect.poll(() => forceRequests).toBe(1);
});

test("автоматически получает завершённую попытку и результат ученика", async ({ page, context }) => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  await page.addInitScript(({ expiresAt }) => localStorage.setItem("sb-127-auth-token", JSON.stringify({
    access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: expiresAt,
    user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "teacher@example.test", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} },
  })), { expiresAt });
  let dashboardRequests = 0;
  const studentId = "66666666-6666-4666-8666-666666666666";
  const assignmentId = "55555555-5555-4555-8555-555555555555";
  const base = {
    settings: { retention_days: 365, review_below: 60, reinforce_below: 80 }, grade_scale: { thresholds: [{ label: "5", min_percent: 85 }, { label: "2", min_percent: 0 }], updated_at: null },
    students: [{ id: studentId, first_name: "Иван", last_name: "Петров", note: null, created_at: new Date().toISOString() }],
    tests: [{ id: "44444444-4444-4444-8444-444444444444", title: "Алгебра", description: "", created_at: new Date().toISOString(), test_versions: [{ id: versionId, version_number: 1, status: "published", published_at: new Date().toISOString(), title_snapshot: "Алгебра" }] }],
  };
  await context.route(apiUrl, async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    if (body.action === "teacher.report") return route.fulfill({ json: { revealed: true, attempt: { id: attemptId, status: "submitted", completion_reason: "student", grade_label: "4", started_at: new Date().toISOString(), submitted_at: new Date().toISOString(), duration_seconds: 120, score_points: 4, max_points: 5, score_percent: 80 }, items: [], topics: [], event_intervals: [] } });
    if (body.action !== "teacher.dashboard") return route.fulfill({ json: {} });
    dashboardRequests += 1;
    const submitted = dashboardRequests > 1;
    return route.fulfill({ json: {
      ...base,
      assignments: [{ id: assignmentId, student_id: studentId, version_id: versionId, deadline_at: new Date(Date.now() + 86_400_000).toISOString(), revoked_at: null, attempts: [{ id: attemptId, status: submitted ? "submitted" : "in_progress", score_points: submitted ? 4 : null, max_points: submitted ? 5 : null, score_percent: submitted ? 80 : null, grade_label: submitted ? "4" : null, completion_reason: submitted ? "student" : null, submitted_at: submitted ? new Date().toISOString() : null }] }],
      operation_rows: [{ assignment_id: assignmentId, attempt_id: attemptId, student_id: studentId, student_name: "Петров Иван", version_id: versionId, test_title: "Алгебра", version_number: 1, status: submitted ? "submitted" : "in_progress", answers_count: submitted ? 2 : 1, questions_count: 2, score_points: submitted ? 4 : null, max_points: submitted ? 5 : null, score_percent: submitted ? 80 : null, grade_label: submitted ? "4" : null, completion_reason: submitted ? "student" : null, telemetry_count: 1, deadline_at: new Date(Date.now() + 86_400_000).toISOString(), submitted_at: submitted ? new Date().toISOString() : null }],
    } });
  });

  await page.goto("/teacher");
  await expect(page.getByText("Активна", { exact: true })).toBeVisible();
  await expect(page.getByText("Завершена", { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("4/5 · 80%")).toBeVisible();
  await expect.poll(() => dashboardRequests).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Отчёт" }).click();
  await expect(page.getByRole("heading", { name: "Подробный отчёт" })).toBeVisible();
  await expect(page.getByText("4/5", { exact: true })).toBeVisible();
});
