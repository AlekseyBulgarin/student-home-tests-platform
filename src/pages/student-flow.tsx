import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, CloudOff, Expand, ListChecks, LoaderCircle, RefreshCw, Save, Send, ShieldCheck, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import type { AttemptState, Report, SafeQuestion } from "@/lib/types";
import { useAttemptAutosave, type SaveStatus } from "@/hooks/use-attempt-autosave";
import { useAttemptMonitoring } from "@/hooks/use-attempt-monitoring";
import { useServerCountdown } from "@/hooks/use-server-countdown";
import { AppShell } from "@/components/app-shell";
import { ReportView } from "@/components/report-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";

type AssignmentPreview = { assignment: { title: string; student_first_name: string; student_last_name: string; deadline_at: string } };

function readSecretFromHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token") ?? "";
  if (token) history.replaceState(null, "", window.location.pathname + window.location.search);
  return token;
}

function SaveIndicator({ status, lastSavedAt }: { status: SaveStatus; lastSavedAt: string | null }) {
  const content = {
    saved: { icon: CheckCircle2, text: lastSavedAt ? `Сохранено в ${new Date(lastSavedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Сохранено" },
    saving: { icon: LoaderCircle, text: "Сохраняется…" },
    offline: { icon: WifiOff, text: "Нет соединения — изменения ожидают отправки" },
    error: { icon: CloudOff, text: "Ошибка сохранения — будет повторено" },
    conflict: { icon: AlertCircle, text: "Обнаружена более новая версия из другой вкладки" },
  }[status];
  const Icon = content.icon;
  return <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Icon className={status === "saving" ? "animate-spin" : undefined} aria-hidden="true" />{content.text}</span>;
}

function QuestionCard({ question, value, disabled, onChange }: { question: SafeQuestion; value: string[]; disabled: boolean; onChange: (next: string[]) => void }) {
  return <Card><CardHeader><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{question.position + 1}</Badge>{question.topics.map((topic) => <Badge key={topic} variant="outline">{topic}</Badge>)}</div><CardTitle id={`question-${question.id}`} className="text-lg leading-relaxed">{question.text}</CardTitle><CardDescription>{question.type === "single_choice" ? "Выберите один вариант" : "Выберите все подходящие варианты"} · {question.points} баллов</CardDescription></CardHeader><CardContent>
    {question.type === "single_choice" ? <RadioGroup disabled={disabled} value={value[0] ?? ""} onValueChange={(next) => onChange(next ? [next as string] : [])} className="flex flex-col gap-3">{question.options.map((option) => <Field key={option.id} orientation="horizontal" data-disabled={disabled}><RadioGroupItem id={`${question.id}-${option.id}`} value={option.id} /><FieldLabel htmlFor={`${question.id}-${option.id}`} className="font-normal">{option.text}</FieldLabel></Field>)}</RadioGroup> : <FieldGroup>{question.options.map((option) => { const checked = value.includes(option.id); return <Field key={option.id} orientation="horizontal" data-disabled={disabled}><Checkbox id={`${question.id}-${option.id}`} checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(next ? [...value, option.id] : value.filter((id) => id !== option.id))} /><FieldLabel htmlFor={`${question.id}-${option.id}`} className="font-normal">{option.text}</FieldLabel></Field>; })}</FieldGroup>}
  </CardContent></Card>;
}

function QuestionNavigator({ questions, answers, activeIndex, onSelect }: { questions: SafeQuestion[]; answers: Record<string, string[]>; activeIndex: number; onSelect: (index: number) => void }) {
  return <aside className="rounded-xl border bg-card p-3 lg:sticky lg:top-24 lg:self-start" aria-label="Навигация по вопросам"><div className="mb-3 flex items-center gap-2 px-1 text-sm font-medium"><ListChecks aria-hidden="true" />Вопросы</div><div className="grid grid-cols-6 gap-2 lg:grid-cols-1">{questions.map((question, index) => { const answered = (answers[question.id]?.length ?? 0) > 0; const active = index === activeIndex; return <Button key={question.id} type="button" variant={active ? "default" : "outline"} className="justify-center lg:justify-start" aria-current={active ? "step" : undefined} aria-controls={`question-${question.id}`} onClick={() => onSelect(index)}><span className="font-mono">{index + 1}</span><span className="hidden lg:inline">{answered ? "Ответ дан" : "Без ответа"}</span><span className={`ml-auto hidden size-2 rounded-full lg:block ${answered ? "bg-emerald-500" : "bg-muted-foreground/35"}`} aria-label={answered ? "Ответ дан" : "Без ответа"} /></Button>; })}</div></aside>;
}

export function StudentFlow() {
  const [assignmentToken] = useState(readSecretFromHash);
  const [sessionToken, setSessionToken] = useState(() => {
    if (assignmentToken) { sessionStorage.removeItem("attempt_session"); return ""; }
    return sessionStorage.getItem("attempt_session") ?? "";
  });
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const [fullscreenWarning, setFullscreenWarning] = useState("");
  const questionAreaRef = useRef<HTMLDivElement>(null);
  const fallbackTimeRef = useRef(new Date().toISOString());
  const submitKeyRef = useRef(crypto.randomUUID());

  const updateRevision = useCallback((revision: number) => {
    setAttempt((current) => current ? { ...current, attempt: { ...current.attempt, revision } } : current);
  }, []);
  const autosave = useAttemptAutosave({
    attemptId: attempt?.attempt.id ?? "", sessionToken, initialRevision: attempt?.attempt.revision ?? 0,
    answers, enabled: attempt?.attempt.status === "in_progress", onRevision: updateRevision,
  });

  const refreshAttempt = useCallback(async () => {
    if (!sessionToken) return;
    const state = await api<AttemptState>("student.attempt", { session_token: sessionToken });
    autosave.resetFromServer(state.answers, state.attempt.revision);
    setAttempt(state); setAnswers(state.answers);
    if (state.attempt.status === "submitted") setReport(await api<Report>("student.report", { session_token: sessionToken }));
  }, [autosave, sessionToken]);

  const handleDeadline = useCallback(() => {
    void refreshAttempt().catch(() => setError("Время истекло. Сервер проверит состояние при следующем соединении."));
  }, [refreshAttempt]);
  const countdown = useServerCountdown(
    attempt?.attempt.deadline_at ?? fallbackTimeRef.current,
    attempt?.attempt.server_time ?? fallbackTimeRef.current,
    attempt?.attempt.status === "in_progress",
    handleDeadline,
  );
  const monitoring = useAttemptMonitoring({
    active: attempt?.attempt.status === "in_progress", attemptId: attempt?.attempt.id ?? "", sessionToken,
    initialSequence: attempt?.attempt.last_event_sequence ?? 0, questionAreaRef,
    onFullscreenExit: () => setFullscreenWarning("Вы вышли из полноэкранного режима. Это событие записано, но не влияет на учебный балл."),
  });

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (sessionToken) {
          const state = await api<AttemptState>("student.attempt", { session_token: sessionToken });
          if (!active) return; autosave.resetFromServer(state.answers, state.attempt.revision); setAttempt(state); setAnswers(state.answers);
          if (state.attempt.status === "submitted") setReport(await api<Report>("student.report", { session_token: sessionToken }));
        } else if (assignmentToken) {
          const next = await api<AssignmentPreview>("student.resolve", { token: assignmentToken });
          if (!active) return; setPreview(next); setFirstName(next.assignment.student_first_name); setLastName(next.assignment.student_last_name);
        } else setError("В ссылке нет секретного токена. Откройте персональную ссылку ещё раз.");
      } catch (next) { if (active) setError(next instanceof Error ? next.message : "Ссылка недействительна"); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [assignmentToken, sessionToken]); // autosave intentionally excluded: its methods are stable for the active attempt.

  const answered = useMemo(() => attempt?.questions.filter((question) => (answers[question.id]?.length ?? 0) > 0).length ?? 0, [answers, attempt]);

  useEffect(() => {
    const length = attempt?.questions.length ?? 0;
    setActiveQuestionIndex((current) => Math.min(current, Math.max(0, length - 1)));
  }, [attempt?.questions.length]);

  useEffect(() => {
    if (!attempt || attempt.attempt.status !== "in_progress") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button, [role='radio'], [role='checkbox']")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); setActiveQuestionIndex((current) => Math.max(0, current - 1)); }
      if (event.key === "ArrowRight") { event.preventDefault(); setActiveQuestionIndex((current) => Math.min(attempt.questions.length - 1, current + 1)); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [attempt]);

  useEffect(() => {
    questionAreaRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [activeQuestionIndex]);

  async function start(event: FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    try {
      if (document.fullscreenEnabled && !document.fullscreenElement) {
        try { await document.documentElement.requestFullscreen(); } catch { setFullscreenWarning("Браузер не разрешил полноэкранный режим. Вы можете продолжить тест."); }
      } else if (!document.fullscreenEnabled) setFullscreenWarning("Полноэкранный режим не поддерживается. Вы можете продолжить тест.");
      const result = await api<AttemptState & { session_token: string }>("student.start", { token: assignmentToken, first_name: firstName, last_name: lastName });
      sessionStorage.setItem("attempt_session", result.session_token); setSessionToken(result.session_token); setAttempt(result); setAnswers(result.answers);
    } catch (next) { setError(next instanceof Error ? next.message : "Не удалось начать тест"); }
    finally { setPending(false); }
  }

  async function returnToFullscreen() {
    try { await document.documentElement.requestFullscreen(); setFullscreenWarning(""); }
    catch { setFullscreenWarning("Не удалось включить полноэкранный режим. Вы можете продолжить тест."); }
  }

  async function submit() {
    setPending(true); setError("");
    try {
      const saved = await autosave.flush();
      if (!saved) { setError("Не удалось сохранить последние ответы. Восстановите соединение или обновите состояние другой вкладки."); return; }
      await monitoring.flushEvents();
      const result = await api<Report>("student.submit", { session_token: sessionToken, idempotency_key: submitKeyRef.current });
      setReport(result); setAttempt((current) => current ? { ...current, attempt: { ...current.attempt, status: "submitted" } } : current);
    } catch (next) { setError(next instanceof Error ? next.message : "Не удалось отправить ответы"); }
    finally { setPending(false); }
  }

  if (loading) return <AppShell><div className="mx-auto flex max-w-3xl flex-col gap-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div></AppShell>;
  if (error && !attempt && !preview) return <AppShell><div className="mx-auto max-w-xl"><Alert variant="destructive"><AlertCircle /><AlertTitle>Тест недоступен</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></div></AppShell>;
  if (report) return <AppShell><div className="mx-auto flex max-w-3xl flex-col gap-6"><div><Badge variant="secondary">Тест завершён</Badge><h1 className="mt-2 text-3xl font-semibold">Ваш результат</h1></div>{report.revealed ? <ReportView report={report} /> : <><div className="grid gap-4 sm:grid-cols-2"><Card><CardHeader><CardDescription>Баллы</CardDescription><CardTitle>{report.attempt.score_points}/{report.attempt.max_points}</CardTitle></CardHeader></Card><Card><CardHeader><CardDescription>Процент</CardDescription><CardTitle>{report.attempt.score_percent}%</CardTitle></CardHeader></Card></div><Alert><Clock3 /><AlertTitle>Подробный разбор пока закрыт</AlertTitle><AlertDescription>Цветовая отметка ответов и статистика по темам появятся, когда преподаватель разрешит раскрытие: сразу после отправки, после дедлайна или вручную — в зависимости от назначения.</AlertDescription></Alert></>}</div></AppShell>;
  if (!attempt && preview) return <AppShell><div className="mx-auto flex max-w-2xl flex-col gap-6"><div><Badge variant="secondary">Персональное назначение</Badge><h1 className="mt-2 text-3xl font-semibold">{preview.assignment.title}</h1><p className="text-muted-foreground">Дедлайн: {new Date(preview.assignment.deadline_at).toLocaleString("ru-RU")}</p></div><Card><CardHeader><CardTitle>Перед началом</CardTitle><CardDescription>Проверьте отображаемое имя и ознакомьтесь с правилами.</CardDescription></CardHeader><form onSubmit={start}><CardContent><FieldGroup>
    <Field><FieldLabel htmlFor="first-name">Имя</FieldLabel><Input id="first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={100} /></Field><Field><FieldLabel htmlFor="last-name">Фамилия</FieldLabel><Input id="last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={100} /></Field>
    <Alert><ShieldCheck /><AlertTitle>Какие события фиксируются</AlertTitle><AlertDescription>Платформа записывает доступные входы и выходы из fullscreen, видимость вкладки, focus/blur, стандартные попытки копирования в области задания и состояние сети. Она не видит системные скриншоты, телефон, другие приложения, историю браузера или содержимое буфера. События неполны, не доказывают списывание и не влияют на балл автоматически.</AlertDescription></Alert>
    {fullscreenWarning ? <Alert><Expand /><AlertTitle>Полноэкранный режим не включён</AlertTitle><AlertDescription>{fullscreenWarning}</AlertDescription></Alert> : null}{error ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Ошибка</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
  </FieldGroup></CardContent><CardFooter><Button type="submit" disabled={pending}>{pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Expand data-icon="inline-start" />}Начать тест</Button></CardFooter></form></Card></div></AppShell>;
  if (!attempt) return null;
  const expired = attempt.attempt.status === "expired";
  return <AppShell><div className="mx-auto flex max-w-3xl flex-col gap-6"><div className="sticky top-0 rounded-xl border bg-background/95 p-4 shadow-sm backdrop-blur"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-medium">Вопросы: {answered}/{attempt.questions.length}</p><div className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">Осталось: <span className="font-mono font-medium text-foreground">{countdown.label}</span></p><SaveIndicator status={autosave.status} lastSavedAt={autosave.lastSavedAt} /></div></div><Badge variant={expired ? "destructive" : "secondary"}>{expired ? "Время истекло" : `v${attempt.attempt.revision}`}</Badge></div><Progress value={attempt.questions.length ? answered / attempt.questions.length * 100 : 0} className="mt-3" /></div>
    {expired ? <Alert variant="destructive"><Clock3 /><AlertTitle>Серверный дедлайн истёк</AlertTitle><AlertDescription>Ответы доступны только для просмотра. Сервер больше не принимает изменения или отправку.</AlertDescription></Alert> : null}
    {fullscreenWarning && !expired ? <Alert><Expand /><AlertTitle>Полноэкранный режим выключен</AlertTitle><AlertDescription className="flex flex-col gap-3"><span>{fullscreenWarning}</span><Button variant="outline" className="w-fit" onClick={() => void returnToFullscreen()}><Expand data-icon="inline-start" />Вернуться в fullscreen</Button></AlertDescription></Alert> : null}
    {autosave.multipleTabs && !expired ? <Alert><RefreshCw /><AlertTitle>Попытка открыта в нескольких вкладках</AlertTitle><AlertDescription className="flex flex-col gap-3"><span>Сервер не позволит устаревшему запросу перезаписать более новую ревизию. Продолжайте в одной вкладке.</span>{autosave.status === "conflict" ? <Button variant="outline" className="w-fit" onClick={() => void refreshAttempt()}><RefreshCw data-icon="inline-start" />Загрузить сохранённую версию</Button> : null}</AlertDescription></Alert> : null}
    {autosave.status === "error" ? <Alert variant="destructive"><CloudOff /><AlertTitle>Ошибка автосохранения</AlertTitle><AlertDescription>Ответы остаются на экране. Платформа повторит отправку после следующего изменения или восстановления сети.</AlertDescription></Alert> : null}
    {autosave.status === "offline" ? <Alert><WifiOff /><AlertTitle>Нет соединения</AlertTitle><AlertDescription>Не закрывайте вкладку. Изменения будут отправлены после восстановления сети.</AlertDescription></Alert> : null}
    {monitoring.deliveryError ? <Alert><AlertCircle /><AlertTitle>Не все события доставлены</AlertTitle><AlertDescription>Телеметрия считается неполной и не используется как доказательство.</AlertDescription></Alert> : null}
    {error ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Ответы не отправлены</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]"><QuestionNavigator questions={attempt.questions} answers={answers} activeIndex={activeQuestionIndex} onSelect={setActiveQuestionIndex} /><div ref={questionAreaRef} className="flex min-w-0 flex-col gap-4" data-testid="question-area">{attempt.questions[activeQuestionIndex] ? <QuestionCard question={attempt.questions[activeQuestionIndex]} value={answers[attempt.questions[activeQuestionIndex].id] ?? []} disabled={expired} onChange={(value) => { const questionId = attempt.questions[activeQuestionIndex].id; setAnswers((current) => ({ ...current, [questionId]: value })); }} /> : null}<div className="flex items-center justify-between gap-3"><Button type="button" variant="outline" onClick={() => setActiveQuestionIndex((current) => Math.max(0, current - 1))} disabled={activeQuestionIndex === 0}><ChevronLeft data-icon="inline-start" />Предыдущая</Button><span className="text-sm text-muted-foreground">Задача {activeQuestionIndex + 1} из {attempt.questions.length}</span><Button type="button" variant="outline" onClick={() => setActiveQuestionIndex((current) => Math.min(attempt.questions.length - 1, current + 1))} disabled={activeQuestionIndex === attempt.questions.length - 1}>Следующая<ChevronRight data-icon="inline-end" /></Button></div></div></div>
    {!expired ? <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" onClick={() => void autosave.flush()} disabled={pending}><Save data-icon="inline-start" />Сохранить сейчас</Button><Dialog><DialogTrigger render={<Button disabled={pending} />}><Send data-icon="inline-start" />Завершить тест</DialogTrigger><DialogContent><DialogHeader><DialogTitle>Отправить ответы?</DialogTitle><DialogDescription>После отправки изменить ответы нельзя. Заполнено {answered} из {attempt.questions.length} вопросов.</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button variant="outline" />}>Продолжить проверку</DialogClose><DialogClose render={<Button onClick={() => void submit()} />}>Отправить</DialogClose></DialogFooter></DialogContent></Dialog></div> : null}
  </div></AppShell>;
}
