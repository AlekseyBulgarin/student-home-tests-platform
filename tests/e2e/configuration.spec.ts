import { expect, test } from "@playwright/test";

test("без переменных окружения показывает понятную инструкцию", async ({ page }) => {
  await page.goto("/teacher/login");
  await expect(page.getByRole("heading", { name: "Кабинет преподавателя" })).toBeVisible();
  await expect(page.getByText("Supabase не настроен")).toBeVisible();
});
