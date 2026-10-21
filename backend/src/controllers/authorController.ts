import type { Request, Response } from "express";
import type { BookService } from "../services/bookService";
import type { TicketService } from "../services/ticketService";
import { authOf, authorIdOf } from "../middleware/auth";
import { validBody } from "../middleware/validate";
import type { CreateTicketInput, MessageBodyInput } from "../schemas/ticketSchemas";

export class AuthorController {
  constructor(
    private readonly books: BookService,
    private readonly tickets: TicketService,
  ) {}

  listBooks = async (req: Request, res: Response) => {
    res.json(await this.books.listForAuthor(authorIdOf(req)));
  };

  createTicket = async (req: Request, res: Response) => {
    res.status(201).json(await this.tickets.create(authorIdOf(req), validBody<CreateTicketInput>(req)));
  };

  listTickets = async (req: Request, res: Response) => {
    res.json(await this.tickets.list(authorIdOf(req)));
  };

  getTicket = async (req: Request<{ id: string }>, res: Response) => {
    res.json(await this.tickets.get(req.params.id, authorIdOf(req)));
  };

  addMessage = async (req: Request<{ id: string }>, res: Response) => {
    const { body } = validBody<MessageBodyInput>(req);
    const message = await this.tickets.addMessage(req.params.id, { authorId: authorIdOf(req), userId: authOf(req).sub }, body);
    res.status(201).json(message);
  };
}
