import bcrypt from "bcryptjs";
import { signToken } from "../lib/jwt";
import { NotFoundError, UnauthorizedError } from "../lib/errors";
import type { UserRepository } from "../repositories/userRepository";

// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export class AuthService {
  constructor(private readonly users: UserRepository) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedError("Invalid email or password");

    const token = signToken({ sub: user.id, role: user.role, authorId: user.author?.id ?? null });
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError("User");
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
}
