import { createHash } from "crypto";

/**
 * Simple password hashing for MVP.
 * TODO: Replace with bcrypt for production.
 */
export async function hash(password: string): Promise<string> {
  return createHash("sha256").update(password).digest("hex");
}

export async function compare(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  const hashed = await hash(password);
  return hashed === hashedPassword;
}
