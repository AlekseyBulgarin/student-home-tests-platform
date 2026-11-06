import { apiUrl, supabase } from "./supabase";

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T>(action: string, payload: Record<string, unknown> = {}, authenticated = false): Promise<T> {
  if (!apiUrl) throw new ApiError("not_configured", "Supabase не настроен");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authenticated) {
    const { data } = await supabase!.auth.getSession();
    if (!data.session) throw new ApiError("unauthorized", "Войдите как преподаватель");
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const response = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({ action, payload }) });
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error?.code ?? "request_failed", body.error?.message ?? "Ошибка запроса", body.error?.details);
  return body as T;
}
