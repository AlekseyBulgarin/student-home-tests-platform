import { expect, test } from "@playwright/test";

const apiUrl = "http://127.0.0.1:54321/functions/v1/api";

test("автосохраняет, переживает offline, восстановление и вторую вкладку", async ({ page, context }) => {
  let revision = 0;
  let answers: Record<string, string[]> = {};
  let saveCount = 0;
  const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
  const attemptState = () => ({
    attempt: { id: "11111111-1111-4111-8111-111111111111", status: "in_progress", started_at: new Date().toISOString(), deadline_at: deadline, revision, server_time: new Date().toISOString(), last_event_sequence: 0, score_points: null, max_points: null, score_percent: null, submitted_at: null },
    questions: [{ id: "22222222-2222-4222-8222-222222222222", stable_id: "q1", type: "single_choice", text: "Сколько будет 2 + 2?", points: 1, position: 0, options: [{ id: "a", text: "4" }, { id: "b", text: "5" }], topics: ["Сложение"] }],
    answers,
  });

  await context.route(apiUrl, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { action: string; payload: Record<string, any> };
    if (body.action === "student.resolve") return route.fulfill({ json: { assignment: { title: "Проверочный тест", student_first_name: "Иван", student_last_name: "Петров", deadline_at: deadline } } });
    if (body.action === "student.start") return route.fulfill({ status: 201, json: { session_token: "session-token-for-playwright-1234567890", ...attemptState() } });
    if (body.action === "student.attempt") return route.fulfill({ json: attemptState() });
    if (body.action === "student.save") {
      revision = Number(body.payload.revision); saveCount += 1;
      answers = Object.fromEntries((body.payload.answers as Array<{ question_id: string; selected_option_ids: string[] }>).map((item) => [item.question_id, item.selected_option_ids]));
      return route.fulfill({ json: { accepted: true, revision, saved_at: new Date().toISOString() } });
    }
    if (body.action === "student.events") return route.fulfill({ json: { accepted: 1, last_sequence: 1, server_time: new Date().toISOString() } });
    return route.fulfill({ status: 404, json: { error: { message: "Неизвестная тестовая операция" } } });
  });

  await page.goto(`/a#token=${"a".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "Проверочный тест" })).toBeVisible();
  await page.getByRole("button", { name: "Начать тест" }).click();
  await expect(page.getByText("Сколько будет 2 + 2?")).toBeVisible();

  await page.getByRole("radio", { name: "4" }).click();
  await expect.poll(() => saveCount).toBe(1);
  await expect(page.getByText(/Сохранено/)).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("radio", { name: "5" }).click();
  await expect(page.getByText(/Нет соединения/).first()).toBeVisible();
  await context.setOffline(false);
  await expect.poll(() => saveCount).toBe(2);

  await page.reload();
  await expect(page.getByRole("radio", { name: "5" })).toBeChecked();

  const secondPage = await context.newPage();
  await secondPage.goto("/teacher/login");
  await secondPage.evaluate(() => sessionStorage.setItem("attempt_session", "session-token-for-playwright-1234567890"));
  await secondPage.goto("/a");
  await expect(secondPage.getByText("Сколько будет 2 + 2?")).toBeVisible();
  await expect(page.getByText("Попытка открыта в нескольких вкладках")).toBeVisible();
});

test("показывает одну задачу и переключает её навигатором и стрелками", async ({ page, context }) => {
  const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
  const state = {
    attempt: { id: "77777777-7777-4777-8777-777777777777", status: "in_progress", started_at: new Date().toISOString(), deadline_at: deadline, revision: 0, server_time: new Date().toISOString(), last_event_sequence: 0, score_points: null, max_points: null, score_percent: null, submitted_at: null },
    questions: [
      { id: "88888888-8888-4888-8888-888888888888", stable_id: "q1", type: "single_choice", text: "Вопрос 1", points: 1, position: 0, options: [{ id: "a", text: "Первый" }, { id: "b", text: "Второй" }], topics: ["Тема 1"] },
      { id: "99999999-9999-4999-8999-999999999999", stable_id: "q2", type: "single_choice", text: "Вопрос 2", points: 1, position: 1, options: [{ id: "a", text: "Третий" }, { id: "b", text: "Четвёртый" }], topics: ["Тема 2"] },
    ],
    answers: {},
  };
  await context.route(apiUrl, async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    if (body.action === "student.resolve") return route.fulfill({ json: { assignment: { title: "Навигационный тест", student_first_name: "Иван", student_last_name: "Петров", deadline_at: deadline } } });
    if (body.action === "student.start") return route.fulfill({ status: 201, json: { session_token: "navigation-session-token-123456789012", ...state } });
    if (body.action === "student.events") return route.fulfill({ json: { accepted: 1, last_sequence: 1, server_time: new Date().toISOString() } });
    return route.fulfill({ json: state });
  });

  await page.goto(`/a#token=${"c".repeat(43)}`);
  await page.getByRole("button", { name: "Начать тест" }).click();
  await expect(page.getByText("Вопрос 1")).toBeVisible();
  await expect(page.getByText("Вопрос 2")).toHaveCount(0);
  await page.getByRole("button", { name: "Следующая" }).click();
  await expect(page.getByText("Вопрос 2")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Вопрос 1")).toBeVisible();
  await page.getByRole("button", { name: /^2/ }).click();
  await expect(page.getByText("Вопрос 2")).toBeVisible();
});

test("показывает статистику и цветовой разбор после разрешённого раскрытия", async ({ page, context }) => {
  const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
  const state = {
    attempt: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "in_progress", started_at: new Date().toISOString(), deadline_at: deadline, revision: 0, server_time: new Date().toISOString(), last_event_sequence: 0, score_points: null, max_points: null, score_percent: null, submitted_at: null },
    questions: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", stable_id: "q1", type: "single_choice", text: "Цветовой вопрос", points: 1, position: 0, options: [{ id: "a", text: "Верный" }, { id: "b", text: "Неверный" }], topics: ["Проверка"] }], answers: {},
  };
  const report = { revealed: true, attempt: { id: state.attempt.id, status: "submitted", completion_reason: "student", grade_label: "2", started_at: state.attempt.started_at, submitted_at: new Date().toISOString(), duration_seconds: 10, score_points: 0, max_points: 1, score_percent: 0 }, topics: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Проверка", earned: 0, max: 1, count: 1, percentage: 0, status: "review", limited_evidence: true }], items: [{ question_id: state.questions[0].id, stable_id: "q1", text: "Цветовой вопрос", selected: [{ id: "b", text: "Неверный" }], correct: [{ id: "a", text: "Верный" }], explanation: "Объяснение", earned_points: 0, max_points: 1, is_correct: false }] };
  await context.route(apiUrl, async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    if (body.action === "student.resolve") return route.fulfill({ json: { assignment: { title: "Отчёт", student_first_name: "Иван", student_last_name: "Петров", deadline_at: deadline } } });
    if (body.action === "student.start") return route.fulfill({ status: 201, json: { session_token: "report-session-token-123456789012345678", ...state } });
    if (body.action === "student.submit") return route.fulfill({ json: report });
    if (body.action === "student.events") return route.fulfill({ json: { accepted: 1, last_sequence: 1, server_time: new Date().toISOString() } });
    return route.fulfill({ json: state });
  });

  await page.goto(`/a#token=${"d".repeat(43)}`);
  await page.getByRole("button", { name: "Начать тест" }).click();
  await page.getByRole("button", { name: "Завершить тест" }).click();
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByText("Статистика по темам")).toBeVisible();
  await expect(page.getByText("Ошибка")).toBeVisible();
  await expect(page.getByText("Правильный ответ")).toBeVisible();
});

test("после серверного дедлайна переводит попытку в режим просмотра", async ({ page, context }) => {
  const deadline = new Date(Date.now() + 1500).toISOString();
  let started = false;
  await context.route(apiUrl, async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    const state = (status: "in_progress" | "expired") => ({
      attempt: { id: "33333333-3333-4333-8333-333333333333", status, started_at: new Date().toISOString(), deadline_at: deadline, revision: 0, server_time: new Date().toISOString(), last_event_sequence: 0, score_points: null, max_points: null, score_percent: null, submitted_at: null },
      questions: [{ id: "44444444-4444-4444-8444-444444444444", stable_id: "q1", type: "single_choice", text: "Вопрос с дедлайном", points: 1, position: 0, options: [{ id: "a", text: "Ответ" }, { id: "b", text: "Другой ответ" }], topics: ["Время"] }],
      answers: {},
    });
    if (body.action === "student.resolve") return route.fulfill({ json: { assignment: { title: "Тест с таймером", student_first_name: "Иван", student_last_name: "Петров", deadline_at: deadline } } });
    if (body.action === "student.start") { started = true; return route.fulfill({ status: 201, json: { session_token: "deadline-session-token-123456789012345", ...state("in_progress") } }); }
    if (body.action === "student.attempt") return route.fulfill({ json: state(started && Date.now() >= Date.parse(deadline) ? "expired" : "in_progress") });
    if (body.action === "student.events") return route.fulfill({ json: { accepted: 1, last_sequence: 1, server_time: new Date().toISOString() } });
    return route.fulfill({ status: 400, json: { error: { message: "Операция недоступна" } } });
  });

  await page.goto(`/a#token=${"b".repeat(43)}`);
  await page.getByRole("button", { name: "Начать тест" }).click();
  await expect(page.getByText("Вопрос с дедлайном")).toBeVisible();
  await expect(page.getByText("Серверный дедлайн истёк")).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole("radio", { name: "Ответ", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Завершить тест" })).toHaveCount(0);
});
