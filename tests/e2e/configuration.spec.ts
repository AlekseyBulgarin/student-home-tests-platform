import { expect, test } from "@playwright/test";

test("показывает защищённый вход преподавателя", async ({ page }) => {
  await page.goto("/teacher/login");
  await expect(page.getByRole("heading", { name: "Кабинет преподавателя" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
});
