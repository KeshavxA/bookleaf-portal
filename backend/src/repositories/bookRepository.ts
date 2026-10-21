import type { Db } from "../lib/prisma";

export class BookRepository {
  constructor(private readonly db: Db) {}

  listByAuthor(authorId: string) {
    // Published books first (most recent), in-production books (no publication date) last.
    return this.db.book.findMany({
      where: { authorId },
      orderBy: [{ publicationDate: { sort: "desc", nulls: "last" } }, { title: "asc" }],
    });
  }

  findOwned(bookId: string, authorId: string) {
    return this.db.book.findFirst({ where: { id: bookId, authorId } });
  }
}
