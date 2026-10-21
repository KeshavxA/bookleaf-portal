import { toBookDto } from "../mappers/dto";
import type { BookRepository } from "../repositories/bookRepository";

export class BookService {
  constructor(private readonly books: BookRepository) {}

  async listForAuthor(authorId: string) {
    return (await this.books.listByAuthor(authorId)).map(toBookDto);
  }
}
