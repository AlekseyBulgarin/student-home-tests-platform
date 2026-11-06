declare module "npm:@supabase/supabase-js@2.57.4" {
  export * from "@supabase/supabase-js";
}

declare module "npm:zod@4.1.12" {
  export * from "zod";
}

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};
