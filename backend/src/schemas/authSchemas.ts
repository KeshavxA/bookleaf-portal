import { z } from "zod";

export const LoginSchema = z.object({
  email: z.email("Must be a valid email address").trim().toLowerCase(),
  password: z.string().min(1, "Password is required").max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;
