import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { AlertCircle, LoaderCircle, LockKeyhole } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AppShell } from "@/components/app-shell";
import { ConfigRequired } from "@/components/config-required";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function TeacherLogin() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  if (!loading && session) return <Navigate to="/teacher" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    const result = await supabase!.auth.signInWithPassword({ email, password });
    if (result.error) setError("Не удалось войти. Проверьте почту и пароль.");
    setPending(false);
  }

  return <AppShell><div className="mx-auto flex max-w-md flex-col gap-6 pt-8">
    <div className="flex flex-col gap-2 text-center"><h1 className="text-3xl font-semibold tracking-tight">Кабинет преподавателя</h1><p className="text-muted-foreground">Управляйте учениками, тестами и результатами.</p></div>
    {!isSupabaseConfigured ? <ConfigRequired /> : <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><LockKeyhole aria-hidden="true" />Вход</CardTitle><CardDescription>Публичная регистрация отключена. Используйте приглашённый аккаунт.</CardDescription></CardHeader>
      <form onSubmit={submit}>
        <CardContent><FieldGroup>
          <Field><FieldLabel htmlFor="email">Электронная почта</FieldLabel><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
          <Field><FieldLabel htmlFor="password">Пароль</FieldLabel><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><FieldDescription>Пароль передаётся только Supabase Auth.</FieldDescription></Field>
          {error ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Ошибка входа</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        </FieldGroup></CardContent>
        <CardFooter><Button type="submit" className="w-full" disabled={pending}>{pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}Войти</Button></CardFooter>
      </form>
    </Card>}
  </div></AppShell>;
}
