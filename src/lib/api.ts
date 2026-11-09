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
  let response: Response;
  try {
    response = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({ action, payload }), signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new ApiError("timeout", "Сервер не ответил вовремя. Повторите операцию.");
    throw new ApiError("network_error", "Не удалось связаться с сервером. Проверьте соединение.");
  }
  const body = await response.json().catch(() => ({ error: { code: "invalid_response", message: "Сервер вернул некорректный ответ" } }));
  if (!response.ok) throw new ApiError(body.error?.code ?? "request_failed", body.error?.message ?? "Ошибка запроса", body.error?.details);
  return body as T;
}
