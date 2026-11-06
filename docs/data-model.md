# Схема данных

Все идентификаторы — UUID. Временные поля — `timestamptz`, серверным источником времени является PostgreSQL. Для изменяемых сущностей используются `created_at`, `updated_at`.

## Таблицы

### `teacher_profiles`

- `id` — PK и FK на `auth.users.id`;
- `display_name`;
- `retention_days` — настройка хранения, по умолчанию 365;
- пороги тем: `review_below = 60`, `reinforce_below = 80`.

### `students`

- `id`, `teacher_id`;
- `first_name`, `last_name`, необязательная заметка;
- `deleted_at` для управляемого удаления до физической очистки.

Уникальность имени не требуется: личность задаётся записью, а не введённым учеником именем.

### `tests`

- `id`, `teacher_id`, `title`, `description`;
- `current_draft_revision`;
- метаданные черновика.

### `test_versions`

- `id`, `test_id`, `version_number`;
- `status`: `draft | published`;
- `title_snapshot`, `description_snapshot`, `settings_snapshot jsonb`;
- `published_at`, `published_by`;
- уникальность `(test_id, version_number)`.

Опубликованные строки и дочерние вопросы неизменяемы триггером. Редактирование опубликованного теста создаёт новую draft-версию.

### `questions`

- `id` — внутренний UUID;
- `version_id`;
- `stable_id` — id из JSON, уникален внутри версии;
- `type`: `single_choice | multiple_choice`;
- `text`, `points`;
- `position`.

### `question_options`

- `id` — внутренний UUID;
- `question_id`;
- `stable_id`, `text`, `position`;
- уникальность `(question_id, stable_id)`.

### `question_keys` (закрытая схема `private`)

- `question_id` — PK;
- `correct_option_stable_ids text[]`;
- `general_explanation`;
- `option_explanations jsonb`.

Клиентские роли не имеют USAGE/SELECT к закрытой схеме. Доступ — только у definer-функций с фиксированным `search_path`.

### `topics` и `question_topics`

- `topics(id, teacher_id, normalized_name, display_name)`;
- `question_topics(question_id, topic_id)`;
- уникальность нормализованного имени в области преподавателя и пары вопрос/тема.

### `assignments`

- `id`, `teacher_id`, `student_id`, `version_id`;
- `token_hash bytea` — уникальный SHA-256;
- `token_hint` — несекретный префикс;
- `starts_at`, `expires_at`, `deadline_at`;
- `revoked_at`, `max_attempts` (v1: 1);
- `disclosure_policy`: `immediate | after_deadline | teacher_released`;
- `released_at`.

### `attempts`

- `id`, `assignment_id`, `version_id`;
- `display_first_name`, `display_last_name`;
- `status`: `in_progress | submitted | expired`;
- `started_at`, `deadline_at_snapshot`, `submitted_at`, `expired_at`;
- `last_client_revision`, `last_sequence`;
- `score_points`, `max_points`, `score_percent`;
- `submission_idempotency_key` — уникален в области попытки;
- `duration_seconds`.

Уникальность активной/первой попытки по assignment обеспечивает идемпотентное начало.

### `attempt_answers`

- `attempt_id`, `question_id` — составной PK;
- `selected_option_stable_ids text[]` в нормализованном сортированном виде;
- `client_revision`, `saved_at`;
- после отправки неизменяемо.

### `attempt_results`

- `attempt_id`, `question_id` — составной PK;
- снимок ответа, правильного ответа и объяснений;
- `earned_points`, `max_points`, `is_correct`;
- создаётся только при отправке и не меняется.

### `attempt_topic_results`

- `attempt_id`, `topic_id`;
- `earned_points`, `max_points`, `question_count`, `percentage`;
- `status`: `review | reinforce | successful`;
- `limited_evidence` — true при числе вопросов ниже настраиваемого минимума.

### `attempt_events`

- `id` — серверный UUID;
- `attempt_id`, `event_id` — уникальная пара для дедупликации;
- `sequence`, `type`;
- `client_occurred_at`, `received_at`;
- `payload jsonb` с жёсткой схемой и лимитом размера.

Разрешённые типы: `fullscreen_enter`, `fullscreen_exit`, `visibility_visible`, `visibility_hidden`, `window_focus`, `window_blur`, `copy_attempt`, `online`, `offline`.

### `audit_log`

- `id`, `teacher_id`, `actor_type`, `actor_id`;
- `action`, `entity_type`, `entity_id`;
- безопасные метаданные без токенов и ответов;
- `created_at`.

### `rate_limit_buckets`

Короткоживущие агрегаты для операций разрешения токена/начала попытки. Ключи — хешированные, значения автоматически удаляются.

## Удаление ученика

Операция преподавателя выполняется серверной функцией в транзакции. По умолчанию каскадно удаляются назначения, попытки, ответы, результаты и события; в `audit_log` остаётся обезличенная запись без имени и содержимого ответа. Политика может быть переключена на немедленное физическое удаление. Очистка по retention удаляет данные завершённых попыток старше установленного срока.

## Основные ограничения БД

- положительные `points`, корректные диапазоны процентов и дат;
- непустые массивы тем и выбранных вариантов там, где это требуется;
- один правильный вариант для `single_choice`, не менее одного — для `multiple_choice`;
- правильные id существуют среди вариантов;
- `attempt.version_id` совпадает с `assignment.version_id`;
- ответы после дедлайна/отправки отклоняются серверной функцией независимо от RLS.

