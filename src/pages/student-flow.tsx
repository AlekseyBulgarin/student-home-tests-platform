import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Clock3, Expand, LoaderCircle, Save, Send, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { AttemptState, Report, SafeQuestion } from "@/lib/types";
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

function QuestionCard({ question, value, onChange }: { question: SafeQuestion; value: string[]; onChange: (next: string[]) => void }) {
  return <Card><CardHeader><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{question.position + 1}</Badge>{question.topics.map((topic) => <Badge key={topic} variant="outline">{topic}</Badge>)}</div><CardTitle className="text-lg leading-relaxed">{question.text}</CardTitle><CardDescription>{question.type === "single_choice" ? "Выберите один вариант" : "Выберите все подходящие варианты"} · {question.points} баллов</CardDescription></CardHeader><CardContent>
    {question.type === "single_choice" ? <RadioGroup value={value[0] ?? ""} onValueChange={(next) => onChange(next ? [next as string] : [])} className="flex flex-col gap-3">{question.options.map((option) => <Field key={option.id} orientation="horizontal"><RadioGroupItem id={`${question.id}-${option.id}`} value={option.id} /><FieldLabel htmlFor={`${question.id}-${option.id}`} className="font-normal">{option.text}</FieldLabel></Field>)}</RadioGroup> : <FieldGroup>{question.options.map((option) => { const checked = value.includes(option.id); return <Field key={option.id} orientation="horizontal"><Checkbox id={`${question.id}-${option.id}`} checked={checked} onCheckedChange={(next) => onChange(next ? [...value, option.id] : value.filter((id) => id !== option.id))} /><FieldLabel htmlFor={`${question.id}-${option.id}`} className="font-normal">{option.text}</FieldLabel></Field>; })}</FieldGroup>}
  </CardContent></Card>;
}

export function StudentFlow() {
  const [assignmentToken] = useState(readSecretFromHash);
  const [sessionToken, setSessionToken] = useState(() => sessionStorage.getItem("attempt_session") ?? "");
  const [preview, setPreview] = useState<AssignmentPreview | null>(null); const [attempt, setAttempt] = useState<AttemptState | null>(null); const [answers, setAnswers] = useState<Record<string, string[]>>({}); const [report, setReport] = useState<Report | null>(null);
  const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState(""); const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false); const [error, setError] = useState(""); const [fullscreenWarning, setFullscreenWarning] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (sessionToken) {
          const state = await api<AttemptState>("student.attempt", { session_token: sessionToken });
          if (!active) return; setAttempt(state); setAnswers(state.answers);
          if (state.attempt.status === "submitted") setReport(await api<Report>("student.report", { session_token: sessionToken }));
        } else if (assignmentToken) {
          const next = await api<AssignmentPreview>("student.resolve", { token: assignmentToken });
          if (!active) return; setPreview(next); setFirstName(next.assignment.student_first_name); setLastName(next.assignment.student_last_name);
        } else setError("В ссылке нет секретного токена. Откройте персональную ссылку ещё раз.");
      } catch (next) { if (active) setError(next instanceof Error ? next.message : "Ссылка недействительна"); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [assignmentToken, sessionToken]);

  const answered = useMemo(() => attempt?.questions.filter((question) => (answers[question.id]?.length ?? 0) > 0).length ?? 0, [answers, attempt]);

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

  async function save() {
    if (!attempt) return; setPending(true); setError("");
    try {
      const revision = attempt.attempt.revision + 1;
      await api("student.save", { session_token: sessionToken, revision, answers: Object.entries(answers).map(([question_id, selected_option_ids]) => ({ question_id, selected_option_ids })) });
      setAttempt((current) => current ? { ...current, attempt: { ...current.attempt, revision } } : current);
    } catch (next) { setError(next instanceof Error ? next.message : "Не удалось сохранить ответы"); throw next; }
    finally { setPending(false); }
  }

  async function submit() {
    setPending(true); setError("");
    try { await save(); const result = await api<Report>("student.submit", { session_token: sessionToken, idempotency_key: crypto.randomUUID() }); setReport(result); setAttempt((current) => current ? { ...current, attempt: { ...current.attempt, status: "submitted" } } : current); }
    catch (next) { setError(next instanceof Error ? next.message : "Не удалось отправить ответы"); }
    finally { setPending(false); }
  }

  if (loading) return <AppShell><div className="mx-auto flex max-w-3xl flex-col gap-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div></AppShell>;
  if (error && !attempt && !preview) return <AppShell><div className="mx-auto max-w-xl"><Alert variant="destructive"><AlertCircle /><AlertTitle>Тест недоступен</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></div></AppShell>;
  if (report) return <AppShell><div className="mx-auto flex max-w-3xl flex-col gap-6"><div><Badge variant="secondary">Тест завершён</Badge><h1 className="mt-2 text-3xl font-semibold">Ваш результат</h1></div>{report.revealed ? <ReportView report={report} /> : <><div className="grid gap-4 sm:grid-cols-2"><Card><CardHeader><CardDescription>Баллы</CardDescription><CardTitle>{report.attempt.score_points}/{report.attempt.max_points}</CardTitle></CardHeader></Card><Card><CardHeader><CardDescription>Процент</CardDescription><CardTitle>{report.attempt.score_percent}%</CardTitle></CardHeader></Card></div><Alert><Clock3 /><AlertTitle>Подробный разбор пока закрыт</AlertTitle><AlertDescription>Правильные ответы и объяснения появятся согласно политике преподавателя.</AlertDescription></Alert></>}</div></AppShell>;
  if (!attempt && preview) return <AppShell><div className="mx-auto flex max-w-2xl flex-col gap-6"><div><Badge variant="secondary">Персональное назначение</Badge><h1 className="mt-2 text-3xl font-semibold">{preview.assignment.title}</h1><p className="text-muted-foreground">Дедлайн: {new Date(preview.assignment.deadline_at).toLocaleString("ru-RU")}</p></div><Card><CardHeader><CardTitle>Перед началом</CardTitle><CardDescription>Проверьте отображаемое имя и ознакомьтесь с правилами.</CardDescription></CardHeader><form onSubmit={start}><CardContent><FieldGroup>
    <Field><FieldLabel htmlFor="first-name">Имя</FieldLabel><Input id="first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={100} /></Field><Field><FieldLabel htmlFor="last-name">Фамилия</FieldLabel><Input id="last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={100} /></Field>
    <Alert><ShieldCheck /><AlertTitle>Какие события могут фиксироваться</AlertTitle><AlertDescription>В следующих этапах платформа будет записывать вход и выход из fullscreen, видимость вкладки, focus/blur, попытки копирования и состояние сети. Эти события неполны, не доказывают списывание и не влияют на балл автоматически.</AlertDescription></Alert>
    {fullscreenWarning ? <Alert><Expand /><AlertTitle>Полноэкранный режим не включён</AlertTitle><AlertDescription>{fullscreenWarning}</AlertDescription></Alert> : null}{error ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Ошибка</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
  </FieldGroup></CardContent><CardFooter><Button type="submit" disabled={pending}>{pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Expand data-icon="inline-start" />}Начать тест</Button></CardFooter></form></Card></div></AppShell>;
  if (!attempt) return null;
  return <AppShell><div className="mx-auto flex max-w-3xl flex-col gap-6"><div className="sticky top-0 rounded-xl border bg-background/95 p-4 shadow-sm backdrop-blur"><div className="flex items-center justify-between gap-4"><div><p className="font-medium">Вопросы: {answered}/{attempt.questions.length}</p><p className="text-sm text-muted-foreground">Дедлайн: {new Date(attempt.attempt.deadline_at).toLocaleString("ru-RU")}</p></div><Badge variant="secondary">v{attempt.attempt.revision}</Badge></div><Progress value={attempt.questions.length ? answered / attempt.questions.length * 100 : 0} className="mt-3" /></div>
    {fullscreenWarning ? <Alert><Expand /><AlertTitle>Продолжение без fullscreen</AlertTitle><AlertDescription>{fullscreenWarning}</AlertDescription></Alert> : null}{error ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Ответы не отправлены</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="flex flex-col gap-4" data-testid="question-area">{attempt.questions.map((question) => <QuestionCard key={question.id} question={question} value={answers[question.id] ?? []} onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))} />)}</div>
    <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" onClick={() => void save()} disabled={pending}><Save data-icon="inline-start" />Сохранить</Button><Dialog><DialogTrigger render={<Button disabled={pending} />}><Send data-icon="inline-start" />Завершить тест</DialogTrigger><DialogContent><DialogHeader><DialogTitle>Отправить ответы?</DialogTitle><DialogDescription>После отправки изменить ответы нельзя. Заполнено {answered} из {attempt.questions.length} вопросов.</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button variant="outline" />}>Продолжить проверку</DialogClose><DialogClose render={<Button onClick={() => void submit()} />}>Отправить</DialogClose></DialogFooter></DialogContent></Dialog></div>
  </div></AppShell>;
}
