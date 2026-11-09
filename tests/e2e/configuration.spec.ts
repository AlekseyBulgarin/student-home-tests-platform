import { expect, test } from "@playwright/test";

const apiUrl = "http://127.0.0.1:54321/functions/v1/api";

test("показывает защищённый вход преподавателя", async ({ page }) => {
  await page.goto("/teacher/login");
  await expect(page.getByRole("heading", { name: "Кабинет преподавателя" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
});

test("переключает и сохраняет тёмную тему", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("class-test-theme")) localStorage.setItem("class-test-theme", "light");
  });
  await page.goto("/teacher/login");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Включить светлую тему" })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("копирует шаблон промпта для генерации JSON", async ({ page, context }) => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5173" });
  await page.addInitScript(({ expiresAt }) => localStorage.setItem("sb-127-auth-token", JSON.stringify({
    access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: expiresAt,
    user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "teacher@example.test", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} },
  })), { expiresAt });
  await context.route(apiUrl, (route) => route.fulfill({ json: {
    settings: { retention_days: 365, review_below: 60, reinforce_below: 80 }, grade_scale: { thresholds: [{ label: "5", min_percent: 85 }, { label: "2", min_percent: 0 }], updated_at: null },
    students: [], tests: [], assignments: [], operation_rows: [],
  } }));

  await page.goto("/teacher");
  await page.getByRole("tab", { name: "Тесты" }).click();
  await page.getByRole("button", { name: "Скопировать промпт для нейросети" }).click();
  await expect(page.getByText("Шаблон промпта скопирован")).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Верни ТОЛЬКО валидный JSON");
});

test("открывает карточку ученика и безопасно перевыпускает личную ссылку", async ({ page, context }) => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const studentId = "66666666-6666-4666-8666-666666666666";
  const assignmentId = "55555555-5555-4555-8555-555555555555";
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5173" });
  await page.addInitScript(({ expiresAt }) => localStorage.setItem("sb-127-auth-token", JSON.stringify({
    access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: expiresAt,
    user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "teacher@example.test", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} },
  })), { expiresAt });
  let reissueRequests = 0;
  await context.route(apiUrl, async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    if (body.action === "teacher.reissue_assignment_link") { reissueRequests += 1; return route.fulfill({ json: { assignment_id: assignmentId, token: "a".repeat(43) } }); }
    return route.fulfill({ json: {
      settings: { retention_days: 365, review_below: 60, reinforce_below: 80 }, grade_scale: { thresholds: [{ label: "5", min_percent: 85 }, { label: "2", min_percent: 0 }], updated_at: null },
      students: [{ id: studentId, first_name: "Иван", last_name: "Петров", note: null, created_at: new Date().toISOString() }], tests: [],
      assignments: [{ id: assignmentId, student_id: studentId, version_id: "22222222-2222-4222-8222-222222222222", deadline_at: new Date(Date.now() + 86_400_000).toISOString(), revoked_at: null, attempts: [] }],
      operation_rows: [{ assignment_id: assignmentId, attempt_id: null, student_id: studentId, student_name: "Петров Иван", version_id: "22222222-2222-4222-8222-222222222222", test_title: "Алгебра", version_number: 1, status: "not_started", answers_count: 0, questions_count: 2, score_points: null, max_points: null, score_percent: null, grade_label: null, completion_reason: null, telemetry_count: 0, deadline_at: new Date(Date.now() + 86_400_000).toISOString(), submitted_at: null }],
    } });
  });

  await page.goto("/teacher");
  await page.getByRole("tab", { name: "Ученики" }).click();
  await page.getByRole("button", { name: "Петров Иван", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Петров Иван" })).toBeVisible();
  await expect(page.getByText("Алгебра")).toBeVisible();
  await page.getByRole("button", { name: "Новая ссылка" }).click();
  await expect(page.getByText("Предыдущая ссылка сразу перестанет работать.")).toBeVisible();
  expect(reissueRequests).toBe(0);
  await page.getByRole("button", { name: "Перевыпустить и скопировать" }).click();
  await expect.poll(() => reissueRequests).toBe(1);
  await expect(page.getByLabel("Новая личная ссылка")).toHaveValue(/#token=a{43}$/);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#token=a{43}$/);
});
