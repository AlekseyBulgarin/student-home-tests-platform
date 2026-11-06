# Платформа домашних тестов

Безопасная веб-платформа для импорта, назначения и прохождения домашних тестов. Интерфейс и документация проекта ведутся на русском языке.

## Текущий статус

Выполнен **этап 3 — надёжность попытки и журнал событий**. Добавлены автосохранение, восстановление, серверный таймер, контроль вкладок, fullscreen-события и rate limiting.

- [Архитектура и границы доверия](docs/architecture.md)
- [Схема данных](docs/data-model.md)
- [Модель доступа и безопасность](docs/access-control.md)
- [Допущения и открытые решения](docs/assumptions.md)
- [План реализации и проверки](docs/implementation-plan.md)
- [Формат импортируемого JSON](docs/json-format.md)
- [Отчёт и ограничения этапа 2](docs/stage-2-report.md)
- [Отчёт и ограничения этапа 3](docs/stage-3-report.md)

## Локальный запуск

Требования: Node.js 22+, npm и Docker Desktop для локального Supabase.

```bash
npm install
npx supabase start
npx supabase db reset
npx supabase functions serve api --env-file supabase/.env.local
```

Скопируйте `.env.example` в `.env.local` и подставьте `API URL` и `anon key`, которые вывел `supabase start`. После этого:

```bash
npm run dev
```

Создайте преподавателя локально через Supabase Studio (`http://127.0.0.1:54323`) в разделе Authentication. Публичная регистрация отключена.

## Проверки

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Полный сквозной тест требует запущенного Supabase. Базовый Playwright-тест без окружения проверяет безопасный экран конфигурации.

## Развёртывание

Фронтенд — обычная статическая сборка Vite из `dist/`, поэтому подходит любой статический хостинг. Миграции применяются через Supabase CLI, Edge Function `api` развёртывается в выбранный Supabase project. В production задайте `ALLOWED_ORIGINS` точным списком frontend origin и никогда не передавайте `SUPABASE_SERVICE_ROLE_KEY` во frontend environment.

Supabase Free имеет квоты БД, Edge Functions и может приостанавливать неактивный проект. Перед production проверьте актуальные лимиты; переход на платный тариф в проекте не выполняется автоматически.

## Выбранный стек

- React, TypeScript, Vite;
- Tailwind CSS и shadcn/ui;
- Supabase PostgreSQL и Supabase Auth для преподавателей;
- Supabase Edge Functions как доверенный серверный слой;
- Zod для общей схемы импорта и проверки входных данных;
- Vitest для unit- и integration-тестов;
- Playwright для основных пользовательских сценариев.

Фронтенд не привязан к конкретному хостингу. Платные сервисы и внешняя аналитика не используются по умолчанию.

## Ключевой принцип

Клиент никогда не получает ключи и объяснения до разрешённого раскрытия и никогда не определяет итоговый балл. Авторизация преподавателя выполняется через Supabase Auth, а ученический доступ — только через ограниченные серверные операции по секретному токену, хеш которого хранится в базе.

