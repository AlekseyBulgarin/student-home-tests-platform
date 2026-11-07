import { useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BarChart3, BookOpenCheck, CalendarClock, CheckCircle2, Clipboard, Download, FileJson, LoaderCircle, Plus, RefreshCcw, Send, Settings, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { parseImport, type ImportTest } from "@/lib/test-schema";
import type { Dashboard, OperationRow, Report } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";
import { AppShell } from "@/components/app-shell";
import { ReportView } from "@/components/report-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

function ErrorAlert({ error }: { error: unknown }) {
  return <Alert variant="destructive"><AlertCircle /><AlertTitle>Не удалось выполнить операцию</AlertTitle><AlertDescription>{error instanceof Error ? error.message : "Повторите позже"}</AlertDescription></Alert>;
}

const statusLabels: Record<OperationRow["status"], string> = { not_started: "Не начата", in_progress: "Активна", submitted: "Завершена", expired: "Просрочена" };
const completionLabels: Record<NonNullable<OperationRow["completion_reason"]>, string> = { student: "ученик", teacher: "преподаватель", deadline: "дедлайн" };

function localDateTime(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function StudentsPanel({ data }: { data: Dashboard }) {
  const client = useQueryClient(); const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState("");
  const mutation = useMutation({ mutationFn: () => api("teacher.create_student", { first_name: firstName, last_name: lastName }, true), onSuccess: async () => { setFirstName(""); setLastName(""); await client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Ученик добавлен"); } });
  const deletion = useMutation({ mutationFn: (studentId: string) => api("teacher.delete_student", { student_id: studentId }, true), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Ученик и связанные результаты удалены"); } });
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  return <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
    <Card><CardHeader><CardTitle>Новый ученик</CardTitle><CardDescription>Имя служит для списка, но не является авторизацией ученика.</CardDescription></CardHeader><form onSubmit={submit}><CardContent><FieldGroup>
      <Field><FieldLabel htmlFor="student-first-name">Имя</FieldLabel><Input id="student-first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={100} required /></Field>
      <Field><FieldLabel htmlFor="student-last-name">Фамилия</FieldLabel><Input id="student-last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={100} required /></Field>
      {mutation.error ? <FieldError>{mutation.error.message}</FieldError> : null}
    </FieldGroup></CardContent><CardFooter><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}Добавить</Button></CardFooter></form></Card>
    <Card><CardHeader><CardTitle>Ученики</CardTitle><CardDescription>{data.students.length} в списке</CardDescription></CardHeader><CardContent>
      {data.students.length ? <Table><TableHeader><TableRow><TableHead>Ученик</TableHead><TableHead>Добавлен</TableHead><TableHead className="text-right">Данные</TableHead></TableRow></TableHeader><TableBody>{data.students.map((student) => <TableRow key={student.id}><TableCell className="font-medium">{student.last_name} {student.first_name}</TableCell><TableCell>{new Date(student.created_at).toLocaleDateString("ru-RU")}</TableCell><TableCell className="text-right"><AlertDialog><AlertDialogTrigger render={<Button variant="ghost" size="sm" aria-label={`Удалить данные ${student.last_name} ${student.first_name}`} />}><Trash2 data-icon="inline-start" />Удалить</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Удалить данные ученика?</AlertDialogTitle><AlertDialogDescription>Будут безвозвратно удалены назначения, попытки, ответы, результаты и журнал событий ученика. В аудит попадёт только обезличенная служебная запись.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deletion.isPending} onClick={() => deletion.mutate(student.id)}>{deletion.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}Удалить данные</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></TableCell></TableRow>)}</TableBody></Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><Users /></EmptyMedia><EmptyTitle>Учеников пока нет</EmptyTitle><EmptyDescription>Добавьте первого ученика слева.</EmptyDescription></EmptyHeader></Empty>}
    </CardContent></Card>
  </div>;
}

function SettingsPanel({ data }: { data: Dashboard }) {
  const client = useQueryClient();
  const [retentionDays, setRetentionDays] = useState(String(data.settings.retention_days));
  const [reviewBelow, setReviewBelow] = useState(String(data.settings.review_below));
  const [reinforceBelow, setReinforceBelow] = useState(String(data.settings.reinforce_below));
  const mutation = useMutation({ mutationFn: () => api("teacher.update_settings", { retention_days: Number(retentionDays), review_below: Number(reviewBelow), reinforce_below: Number(reinforceBelow) }, true), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Настройки сохранены"); } });
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  return <Card className="max-w-2xl"><CardHeader><CardTitle>Хранение и пороги тем</CardTitle><CardDescription>Retention удаляет завершённые или просроченные назначения вместе с результатами после указанного срока. Очистка запускается отдельной серверной задачей.</CardDescription></CardHeader><form onSubmit={submit}><CardContent><FieldGroup>
    <Field><FieldLabel htmlFor="retention-days">Срок хранения, дней</FieldLabel><Input id="retention-days" type="number" min="1" max="3650" value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} required /><FieldDescription>От 1 до 3650 дней; по умолчанию 365.</FieldDescription></Field>
    <Field><FieldLabel htmlFor="review-below">«Разобрать» ниже, %</FieldLabel><Input id="review-below" type="number" min="1" max="99" value={reviewBelow} onChange={(event) => setReviewBelow(event.target.value)} required /></Field>
    <Field><FieldLabel htmlFor="reinforce-below">«Закрепить» ниже, %</FieldLabel><Input id="reinforce-below" type="number" min="2" max="100" value={reinforceBelow} onChange={(event) => setReinforceBelow(event.target.value)} required /></Field>
    {mutation.error ? <ErrorAlert error={mutation.error} /> : null}
  </FieldGroup></CardContent><CardFooter><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Settings data-icon="inline-start" />}Сохранить настройки</Button></CardFooter></form></Card>;
}

function GradeScalePanel({ data }: { data: Dashboard }) {
  const client = useQueryClient(); const [thresholds, setThresholds] = useState(data.grade_scale.thresholds);
  const mutation = useMutation({ mutationFn: () => api("teacher.update_grade_scale", { thresholds }, true), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Шкала сохранена для новых результатов"); } });
  const update = (index: number, key: "label" | "min_percent", value: string) => setThresholds((current) => current.map((threshold, position) => position === index ? { ...threshold, [key]: key === "min_percent" ? Number(value) : value } : threshold));
  return <Card className="max-w-2xl"><CardHeader><CardTitle>Шкала оценок</CardTitle><CardDescription>Пороги идут от высокого к низкому, последний должен быть 0%. Новая шкала применяется только к будущим оцениваниям и явному пересчёту.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">{thresholds.map((threshold, index) => <div key={`${index}-${threshold.label}`} className="grid grid-cols-[1fr_120px_auto] gap-2"><Input value={threshold.label} onChange={(event) => update(index, "label", event.target.value)} aria-label={`Оценка ${index + 1}`} /><Input type="number" min="0" max="100" value={threshold.min_percent} onChange={(event) => update(index, "min_percent", event.target.value)} aria-label={`Порог ${index + 1}`} /><Button variant="ghost" size="sm" disabled={thresholds.length <= 2} onClick={() => setThresholds((current) => current.filter((_, position) => position !== index))}><Trash2 />Удалить</Button></div>)}<div><Button variant="outline" size="sm" disabled={thresholds.length >= 10} onClick={() => setThresholds((current) => [...current, { label: "Новая", min_percent: 0 }])}><Plus data-icon="inline-start" />Добавить порог</Button></div>{mutation.error ? <ErrorAlert error={mutation.error} /> : null}</CardContent><CardFooter><Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Settings data-icon="inline-start" />}Сохранить шкалу</Button></CardFooter></Card>;
}

function TestsPanel({ data }: { data: Dashboard }) {
  const client = useQueryClient(); const [json, setJson] = useState(""); const preview = useMemo(() => json.trim() ? parseImport(json) : null, [json]);
  const importMutation = useMutation({ mutationFn: (test: ImportTest) => api("teacher.import_test", { test }, true), onSuccess: async () => { setJson(""); await client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Черновик импортирован"); } });
  const publishMutation = useMutation({ mutationFn: (versionId: string) => api("teacher.publish_version", { version_id: versionId }, true), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Версия опубликована и больше не изменяется"); } });
  return <div className="flex flex-col gap-6">
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileJson />Импорт JSON</CardTitle><CardDescription>До публикации можно проверить структуру и ключи. Сервер повторяет полную валидацию.</CardDescription></CardHeader><CardContent><FieldGroup>
      <Field data-invalid={Boolean(preview && !preview.success)}><FieldLabel htmlFor="test-json">JSON теста</FieldLabel><Textarea id="test-json" className="min-h-56 font-mono text-xs" value={json} onChange={(event) => setJson(event.target.value)} placeholder="Вставьте JSON по формату docs/json-format.md" aria-invalid={Boolean(preview && !preview.success)} /><FieldDescription>До 1 МБ и 200 вопросов. HTML не поддерживается.</FieldDescription></Field>
      {preview && !preview.success ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Ошибки импорта</AlertTitle><AlertDescription><ul className="flex list-disc flex-col gap-1 pl-5">{preview.errors.slice(0, 20).map((error) => <li key={error}>{error}</li>)}</ul></AlertDescription></Alert> : null}
      {preview?.success ? <Alert><CheckCircle2 /><AlertTitle>{preview.data.title}</AlertTitle><AlertDescription>{preview.data.questions.length} вопросов · {preview.data.questions.reduce((sum, question) => sum + question.points, 0)} баллов. Ключи проверены локально и будут сохранены в закрытой схеме.</AlertDescription></Alert> : null}
      {preview?.success ? <div className="flex max-h-96 flex-col gap-3 overflow-y-auto rounded-xl border bg-muted/20 p-3" aria-label="Предпросмотр вопросов">{preview.data.questions.map((question, index) => <Card key={question.id} className="[content-visibility:auto]"><CardHeader><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{index + 1}</Badge><Badge variant="outline">{question.type}</Badge>{question.topics.map((topic) => <Badge key={topic} variant="outline">{topic}</Badge>)}</div><CardTitle className="text-base">{question.text}</CardTitle><CardDescription>{question.points} баллов</CardDescription></CardHeader><CardContent className="flex flex-col gap-2 text-sm"><ul className="flex list-disc flex-col gap-1 pl-5">{question.options.map((option) => <li key={option.id} className={question.correct_option_ids.includes(option.id) ? "font-medium" : undefined}>{option.text}{question.correct_option_ids.includes(option.id) ? " — правильный" : ""}</li>)}</ul><p className="text-muted-foreground">{question.explanation || "Общее объяснение не задано"}</p></CardContent></Card>)}</div> : null}
      {importMutation.error ? <ErrorAlert error={importMutation.error} /> : null}
    </FieldGroup></CardContent><CardFooter><Button disabled={!preview?.success || importMutation.isPending} onClick={() => preview?.success && importMutation.mutate(preview.data)}>{importMutation.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <FileJson data-icon="inline-start" />}Импортировать черновик</Button></CardFooter></Card>
    <Card><CardHeader><CardTitle>Тесты и версии</CardTitle><CardDescription>Опубликованная версия неизменяема.</CardDescription></CardHeader><CardContent>{data.tests.length ? <Table><TableHeader><TableRow><TableHead>Тест</TableHead><TableHead>Версия</TableHead><TableHead>Статус</TableHead><TableHead className="text-right">Действие</TableHead></TableRow></TableHeader><TableBody>{data.tests.flatMap((test) => test.test_versions.map((version) => <TableRow key={version.id}><TableCell><div className="flex flex-col"><span className="font-medium">{test.title}</span><span className="text-xs text-muted-foreground">{test.description}</span></div></TableCell><TableCell>v{version.version_number}</TableCell><TableCell><Badge variant={version.status === "published" ? "default" : "secondary"}>{version.status === "published" ? "Опубликован" : "Черновик"}</Badge></TableCell><TableCell className="text-right">{version.status === "draft" ? <Button size="sm" onClick={() => publishMutation.mutate(version.id)} disabled={publishMutation.isPending}><BookOpenCheck data-icon="inline-start" />Опубликовать</Button> : "—"}</TableCell></TableRow>))}</TableBody></Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><FileJson /></EmptyMedia><EmptyTitle>Тестов пока нет</EmptyTitle><EmptyDescription>Вставьте JSON и проверьте предпросмотр.</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card>
  </div>;
}

function AssignPanel({ data }: { data: Dashboard }) {
  const client = useQueryClient(); const [studentId, setStudentId] = useState(""); const [versionId, setVersionId] = useState(""); const [deadline, setDeadline] = useState(""); const [policy, setPolicy] = useState("after_deadline"); const [link, setLink] = useState("");
  const versions = data.tests.flatMap((test) => test.test_versions.filter((version) => version.status === "published").map((version) => ({ ...version, title: test.title })));
  const mutation = useMutation({ mutationFn: () => api<{ token: string }>("teacher.assign", { student_id: studentId, version_id: versionId, deadline_at: new Date(deadline).toISOString(), disclosure_policy: policy }, true), onSuccess: async ({ token }) => { const value = `${window.location.origin}/a#token=${encodeURIComponent(token)}`; setLink(value); await client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Назначение создано. Сохраните ссылку — повторно токен не показывается."); } });
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  return <div className="grid gap-6 lg:grid-cols-[1fr_360px]"><Card><CardHeader><CardTitle>Назначить тест</CardTitle><CardDescription>Секрет хранится только в ссылке; в базе остаётся его хеш.</CardDescription></CardHeader><form onSubmit={submit}><CardContent><FieldGroup>
    <Field><FieldLabel>Ученик</FieldLabel><Select value={studentId} onValueChange={(value) => setStudentId(value as string)}><SelectTrigger className="w-full"><SelectValue placeholder="Выберите ученика" /></SelectTrigger><SelectContent><SelectGroup>{data.students.map((student) => <SelectItem key={student.id} value={student.id}>{student.last_name} {student.first_name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
    <Field><FieldLabel>Опубликованный тест</FieldLabel><Select value={versionId} onValueChange={(value) => setVersionId(value as string)}><SelectTrigger className="w-full"><SelectValue placeholder="Выберите версию" /></SelectTrigger><SelectContent><SelectGroup>{versions.map((version) => <SelectItem key={version.id} value={version.id}>{version.title} · v{version.version_number}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
    <Field><FieldLabel htmlFor="deadline">Дедлайн</FieldLabel><Input id="deadline" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} required /></Field>
    <Field><FieldLabel>Раскрытие ответов</FieldLabel><Select value={policy} onValueChange={(value) => setPolicy(value as string)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="immediate">Сразу после отправки</SelectItem><SelectItem value="after_deadline">После дедлайна</SelectItem><SelectItem value="teacher_released">После разрешения преподавателя</SelectItem></SelectGroup></SelectContent></Select></Field>
    {mutation.error ? <ErrorAlert error={mutation.error} /> : null}
  </FieldGroup></CardContent><CardFooter><Button type="submit" disabled={!studentId || !versionId || !deadline || mutation.isPending}>{mutation.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}Создать персональную ссылку</Button></CardFooter></form></Card>
  <Card><CardHeader><CardTitle>Персональная ссылка</CardTitle><CardDescription>Передайте её только назначенному ученику.</CardDescription></CardHeader><CardContent>{link ? <div className="flex flex-col gap-3"><Input value={link} readOnly aria-label="Персональная ссылка" /><Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(link); toast.success("Ссылка скопирована"); }}><Clipboard data-icon="inline-start" />Скопировать</Button></div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><Send /></EmptyMedia><EmptyTitle>Ссылка ещё не создана</EmptyTitle><EmptyDescription>Заполните форму назначения.</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card></div>;
}

type PendingOperation =
  | { kind: "extend"; row: OperationRow }
  | { kind: "bulk" }
  | { kind: "force"; row: OperationRow }
  | { kind: "regrade"; row: OperationRow };

function OperationsPanel({ data }: { data: Dashboard }) {
  const client = useQueryClient();
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("all"); const [versionId, setVersionId] = useState("all");
  const [deadline, setDeadline] = useState(localDateTime(new Date(Date.now() + 86_400_000).toISOString()));
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [report, setReport] = useState<Report | null>(null); const [reportOpen, setReportOpen] = useState(false); const [reportError, setReportError] = useState<unknown>();
  const filters = { search, ...(status !== "all" ? { status } : {}), ...(versionId !== "all" ? { test_version_id: versionId } : {}) };
  const rows = useMemo(() => data.operation_rows.filter((row) => {
    const query = search.trim().toLocaleLowerCase("ru");
    return (!query || `${row.student_name} ${row.test_title}`.toLocaleLowerCase("ru").includes(query))
      && (status === "all" || row.status === status) && (versionId === "all" || row.version_id === versionId);
  }), [data.operation_rows, search, status, versionId]);
  const published = data.tests.flatMap((test) => test.test_versions.filter((version) => version.status === "published").map((version) => ({ ...version, title: test.title })));
  const mutation = useMutation({
    mutationFn: ({ action, payload }: { action: string; payload: Record<string, unknown> }) => api(action, payload, true),
    onSuccess: async () => { setPending(null); await client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Операция выполнена и записана в аудит"); },
  });
  const exportMutation = useMutation({
    mutationFn: () => api<{ csv: string }>("teacher.export_attempts", filters, true),
    onSuccess: ({ csv }) => {
      const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(file);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "попытки-тестов.csv"; anchor.click(); URL.revokeObjectURL(url);
      toast.success("CSV сформирован только по вашим текущим данным");
    },
  });
  const run = () => {
    if (!pending) return;
    if (pending.kind === "extend") mutation.mutate({ action: "teacher.extend_attempt", payload: { attempt_id: pending.row.attempt_id, deadline_at: new Date(deadline).toISOString() } });
    if (pending.kind === "bulk") mutation.mutate({ action: "teacher.extend_test_attempts", payload: { version_id: versionId, deadline_at: new Date(deadline).toISOString() } });
    if (pending.kind === "force") mutation.mutate({ action: "teacher.force_finish_attempt", payload: { attempt_id: pending.row.attempt_id } });
    if (pending.kind === "regrade") mutation.mutate({ action: "teacher.regrade_attempt", payload: { attempt_id: pending.row.attempt_id } });
  };
  const loadReport = async (attemptId: string) => { try { setReport(null); setReportError(undefined); setReportOpen(true); setReport(await api<Report>("teacher.report", { attempt_id: attemptId }, true)); } catch (error) { setReportError(error); } };
  const actionDescription = pending?.kind === "extend" ? "Дедлайн активной попытки будет продлён. Изменение доступно только владельцу попытки."
    : pending?.kind === "bulk" ? "Дедлайны всех активных попыток выбранной версии будут продлены. Завершённые и просроченные попытки не изменятся."
      : pending?.kind === "force" ? "Попытка будет немедленно завершена с причиной «преподаватель» и оценена сервером. Ответы ученика не изменятся."
        : "Сервер заново посчитает уже сохранённые ответы. Оценка будет пересчитана по текущей шкале, ответы не изменятся.";
  return <div className="flex flex-col gap-6">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{published.map((version) => {
      const summary = data.operation_rows.filter((row) => row.version_id === version.id); const complete = summary.filter((row) => row.status === "submitted" && row.score_percent != null);
      const average = complete.length ? Math.round((complete.reduce((sum, row) => sum + Number(row.score_percent), 0) / complete.length) * 100) / 100 : null;
      return <Card key={version.id}><CardHeader><CardDescription>{version.title} · v{version.version_number}</CardDescription><CardTitle className="text-lg">{summary.length} назначений</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2 text-sm"><span>Не начаты: {summary.filter((row) => row.status === "not_started").length}</span><span>Активны: {summary.filter((row) => row.status === "in_progress").length}</span><span>Завершены: {complete.length}</span><span>Просрочены: {summary.filter((row) => row.status === "expired").length}</span><span className="col-span-2 font-medium">Средний результат: {average == null ? "—" : `${average}%`}</span></CardContent></Card>;
    })}</div>
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><BarChart3 />Операционная панель</CardTitle><CardDescription>События телеметрии показаны отдельно и не влияют на учебную оценку.</CardDescription></div><Button variant="outline" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}><Download data-icon="inline-start" />CSV текущей выборки</Button></div></CardHeader><CardContent className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск ученика или теста" aria-label="Поиск попыток" /><Select value={status} onValueChange={(value) => setStatus(value as string)}><SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">Все статусы</SelectItem>{Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select><Select value={versionId} onValueChange={(value) => setVersionId(value as string)}><SelectTrigger><SelectValue placeholder="Тест" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">Все тесты</SelectItem>{published.map((version) => <SelectItem key={version.id} value={version.id}>{version.title} · v{version.version_number}</SelectItem>)}</SelectGroup></SelectContent></Select><Input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} aria-label="Новый дедлайн" /></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={versionId === "all" || !deadline} onClick={() => setPending({ kind: "bulk" })}><CalendarClock data-icon="inline-start" />Продлить активные выбранного теста</Button>{mutation.error ? <ErrorAlert error={mutation.error} /> : null}{exportMutation.error ? <ErrorAlert error={exportMutation.error} /> : null}</div>
      {rows.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Ученик / тест</TableHead><TableHead>Статус и прогресс</TableHead><TableHead>Результат</TableHead><TableHead>Завершение</TableHead><TableHead>Телеметрия</TableHead><TableHead>Дедлайн</TableHead><TableHead className="text-right">Действия</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.assignment_id}><TableCell><div className="flex flex-col"><span className="font-medium">{row.student_name}</span><span className="text-xs text-muted-foreground">{row.test_title} · v{row.version_number}</span></div></TableCell><TableCell><Badge variant="secondary">{statusLabels[row.status]}</Badge><p className="mt-1 text-xs text-muted-foreground">{row.answers_count}/{row.questions_count} ответов</p></TableCell><TableCell>{row.score_percent == null ? "—" : <>{row.score_points}/{row.max_points} · {row.score_percent}%<p className="text-xs text-muted-foreground">Оценка: {row.grade_label ?? "—"}</p></>}</TableCell><TableCell>{row.completion_reason ? completionLabels[row.completion_reason] : "—"}</TableCell><TableCell>{row.telemetry_count ? `${row.telemetry_count} событий` : "Нет"}</TableCell><TableCell>{new Date(row.deadline_at).toLocaleString("ru-RU")}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-1">{row.attempt_id ? <Button size="sm" variant="outline" onClick={() => void loadReport(row.attempt_id!)}>Отчёт</Button> : null}{row.status === "in_progress" && row.attempt_id ? <><Button size="sm" variant="outline" onClick={() => setPending({ kind: "extend", row })}>Продлить</Button><Button size="sm" variant="destructive" onClick={() => setPending({ kind: "force", row })}>Завершить</Button></> : null}{row.status === "submitted" && row.attempt_id ? <Button size="sm" variant="outline" onClick={() => setPending({ kind: "regrade", row })}><RefreshCcw />Пересчитать</Button> : null}</div></TableCell></TableRow>)}</TableBody></Table></div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><BarChart3 /></EmptyMedia><EmptyTitle>В выборке нет попыток</EmptyTitle><EmptyDescription>Измените поиск или фильтры.</EmptyDescription></EmptyHeader></Empty>}
    </CardContent></Card>
    <AlertDialog open={Boolean(pending)} onOpenChange={(open) => { if (!open && !mutation.isPending) setPending(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Подтвердить действие?</AlertDialogTitle><AlertDialogDescription>{actionDescription}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={mutation.isPending}>Отмена</AlertDialogCancel><AlertDialogAction disabled={mutation.isPending} onClick={run}>{mutation.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}Подтвердить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={reportOpen} onOpenChange={setReportOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Подробный отчёт</DialogTitle><DialogDescription>Серверный результат и отдельный журнал телеметрии.</DialogDescription></DialogHeader>{reportError ? <ErrorAlert error={reportError} /> : report ? <ReportView report={report} /> : <Skeleton className="h-48" />}</DialogContent></Dialog>
  </div>;
}

function ResultsPanel({ data }: { data: Dashboard }) {
  const [report, setReport] = useState<Report | null>(null); const [open, setOpen] = useState(false); const [error, setError] = useState<unknown>();
  const studentMap = new Map(data.students.map((student) => [student.id, `${student.last_name} ${student.first_name}`]));
  const load = async (attemptId: string) => { try { setError(undefined); setOpen(true); setReport(await api<Report>("teacher.report", { attempt_id: attemptId }, true)); } catch (next) { setError(next); } };
  return <Card><CardHeader><CardTitle>Результаты</CardTitle><CardDescription>Учебная оценка и журнал событий разделены.</CardDescription></CardHeader><CardContent>{data.assignments.some((assignment) => assignment.attempts?.length) ? <Table><TableHeader><TableRow><TableHead>Ученик</TableHead><TableHead>Статус</TableHead><TableHead>Результат</TableHead><TableHead className="text-right">Отчёт</TableHead></TableRow></TableHeader><TableBody>{data.assignments.flatMap((assignment) => (assignment.attempts ?? []).map((attempt) => <TableRow key={attempt.id}><TableCell className="font-medium">{studentMap.get(assignment.student_id)}</TableCell><TableCell><Badge variant="secondary">{attempt.status}</Badge></TableCell><TableCell>{attempt.score_percent == null ? "—" : `${attempt.score_percent}%`}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => void load(attempt.id)}>Открыть</Button></TableCell></TableRow>))}</TableBody></Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><BookOpenCheck /></EmptyMedia><EmptyTitle>Попыток пока нет</EmptyTitle><EmptyDescription>Результаты появятся после входа ученика по ссылке.</EmptyDescription></EmptyHeader></Empty>}</CardContent>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Подробный отчёт</DialogTitle><DialogDescription>Серверный результат по конкретной версии теста.</DialogDescription></DialogHeader>{error ? <ErrorAlert error={error} /> : report ? <ReportView report={report} /> : <div className="flex flex-col gap-3"><Skeleton className="h-20" /><Skeleton className="h-32" /></div>}</DialogContent></Dialog></Card>;
}

export function TeacherDashboard() {
  const { session, loading } = useAuth();
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("teacher.dashboard", {}, true), enabled: Boolean(session) });
  if (!loading && !session) return <Navigate to="/teacher/login" replace />;
  return <AppShell onSignOut={() => void supabase!.auth.signOut()}><div className="flex flex-col gap-6"><div><h1 className="text-3xl font-semibold tracking-tight">Кабинет преподавателя</h1><p className="text-muted-foreground">Импортируйте тест, опубликуйте версию и назначьте её ученику.</p></div>
    {query.error ? <ErrorAlert error={query.error} /> : null}
    {query.isLoading || !query.data ? <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : <Tabs defaultValue="operations"><TabsList className="w-full justify-start overflow-x-auto"><TabsTrigger value="operations"><BarChart3 />Панель</TabsTrigger><TabsTrigger value="students"><Users />Ученики</TabsTrigger><TabsTrigger value="tests"><FileJson />Тесты</TabsTrigger><TabsTrigger value="assign"><Send />Назначить</TabsTrigger><TabsTrigger value="results"><BookOpenCheck />Результаты</TabsTrigger><TabsTrigger value="settings"><Settings />Настройки</TabsTrigger></TabsList><TabsContent value="operations"><OperationsPanel data={query.data} /></TabsContent><TabsContent value="students"><StudentsPanel data={query.data} /></TabsContent><TabsContent value="tests"><TestsPanel data={query.data} /></TabsContent><TabsContent value="assign"><AssignPanel data={query.data} /></TabsContent><TabsContent value="results"><ResultsPanel data={query.data} /></TabsContent><TabsContent value="settings"><div className="flex flex-col gap-6"><SettingsPanel data={query.data} /><GradeScalePanel data={query.data} /></div></TabsContent></Tabs>}
  </div></AppShell>;
}
