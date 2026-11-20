import { z } from "zod";

const defaultOrigins = "http://127.0.0.1:8080,http://localhost:8080";

function isOrigin(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

const fields = z.object({
  PORT: z.string().regex(/^\d+$/).default("8080").transform(Number).pipe(z.int().min(1).max(65535)),
  HOST: z.enum(["0.0.0.0", "127.0.0.1"]).default("127.0.0.1"),
  DATA_DIR: z.string().min(1).default("/data"),
  PROVIDER: z.enum(["mock", "gemini"]).default("mock"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.6-flash"),
  ALLOWED_ORIGINS: z.string().default(defaultOrigins).transform((value) => value.split(",").map((origin) => origin.trim()))
    .pipe(z.array(z.string().refine(isOrigin)).min(1)),
  LOCAL_HTTP_COOKIES: z.enum(["0", "1"]).default("0").transform((value) => value === "1"),
}).superRefine((env, context) => {
  if (env.LOCAL_HTTP_COOKIES && env.ALLOWED_ORIGINS.some((origin) => {
    const { protocol, hostname } = new URL(origin);
    return protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  })) {
    context.addIssue({ code: "custom", path: ["LOCAL_HTTP_COOKIES"], message: "Local HTTP cookies require loopback HTTP origins" });
  }
  if (env.PROVIDER === "gemini" && !env.GEMINI_API_KEY?.trim()) {
    context.addIssue({ code: "custom", path: ["GEMINI_API_KEY"], message: "GEMINI_API_KEY is required when PROVIDER=gemini" });
  }
}).transform(({ GEMINI_API_KEY, ...config }) => config.PROVIDER === "gemini"
  ? { ...config, GEMINI_API_KEY }
  : config);

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

export type Config = Omit<z.output<typeof fields>, "GEMINI_API_KEY"> & { GEMINI_API_KEY?: string };
