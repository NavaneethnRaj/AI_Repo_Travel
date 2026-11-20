import { z } from "zod";

const fields = z.object({
  PORT: z.string().regex(/^\d+$/).default("8080").transform(Number).pipe(z.int().min(1).max(65535)),
  HOST: z.enum(["0.0.0.0", "127.0.0.1"]).default("127.0.0.1"),
  DATA_DIR: z.string().min(1).default("/data"),
  PROVIDER: z.enum(["mock", "gemini"]).default("mock"),
  GEMINI_API_KEY: z.string().optional(),
}).superRefine((env, context) => {
  if (env.PROVIDER === "gemini" && !env.GEMINI_API_KEY?.trim()) {
    context.addIssue({ code: "custom", path: ["GEMINI_API_KEY"], message: "GEMINI_API_KEY is required when PROVIDER=gemini" });
  }
}).transform(({ GEMINI_API_KEY: _key, ...config }) => config);

export function readConfig(env: NodeJS.ProcessEnv) {
  const result = fields.safeParse(env);
  if (!result.success) {
    const messages = result.error.issues.map((issue) =>
      issue.code === "custom" ? issue.message : `Invalid configuration for ${issue.path.join(".")}`,
    );
    throw new Error(messages.join(". "));
  }

  return result.data;
}

export type Config = ReturnType<typeof readConfig>;
