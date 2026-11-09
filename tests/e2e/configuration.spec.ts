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
