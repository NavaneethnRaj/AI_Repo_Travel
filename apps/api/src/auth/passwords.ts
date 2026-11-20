import { hash, verify } from "@node-rs/argon2";
import { problem } from "../http.js";

const parameters = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// A valid PHC encoding with a random salt and a random digest for unknown accounts.
const dummy = '$argon2id$v=19$m=19456,t=2,p=1$XxfXFypB1iwyejDZRupWsg$VIKNh3yLb1UJWbCwy8qRLLdROK9o+W+1acrIwY6P3Qg';
let active = 0;

async function bounded<T>(work: () => Promise<T>) {
  if (active >= 3) problem(503, "AUTH_BUSY", "Authentication is temporarily busy");
  active++;
  try {
    return await work();
  } finally {
    active--;
  }
}

export function hashPassword(password: string) {
  return bounded(() => hash(password, parameters));
}

export function verifyPassword(password: string, storedHash?: string) {
  return bounded(() => verify(storedHash ?? dummy, password.normalize("NFKC")));
}
