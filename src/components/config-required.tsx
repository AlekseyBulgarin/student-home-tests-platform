import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ConfigRequired() {
  return <Alert variant="destructive"><AlertCircle /><AlertTitle>Supabase не настроен</AlertTitle><AlertDescription>Скопируйте `.env.example` в `.env.local`, запустите локальный Supabase и укажите URL и anon key.</AlertDescription></Alert>;
}
