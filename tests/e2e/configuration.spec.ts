import { expect, test } from "@playwright/test";

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
