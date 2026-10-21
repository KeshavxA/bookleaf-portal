import type { Db } from "../lib/prisma";

export class UserRepository {
  constructor(private readonly db: Db) {}

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email: email.toLowerCase() }, include: { author: true } });
  }

  findById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  listAdmins() {
    return this.db.user.findMany({ where: { role: "ADMIN" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  }

  async isAdmin(id: string): Promise<boolean> {
    const user = await this.db.user.findUnique({ where: { id }, select: { role: true } });
    return user?.role === "ADMIN";
  }
}
