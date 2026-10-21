import type { Request, Response } from "express";
import type { AdminTicketService } from "../services/adminTicketService";
import type { DraftService } from "../services/draftService";
import { authOf } from "../middleware/auth";
import { validBody, validQuery } from "../middleware/validate";
import type { AdminTicketQuery, ReplyInput, UpdateTicketInput } from "../schemas/adminSchemas";
import type { MessageBodyInput } from "../schemas/ticketSchemas";

type IdReq = Request<{ id: string }>;

export class AdminController {
  constructor(
    private readonly tickets: AdminTicketService,
    private readonly drafts: DraftService,
  ) {}

  listTickets = async (req: Request, res: Response) => {
    const q = validQuery<AdminTicketQuery>(req);
    const assigneeId =
      q.assigneeId === undefined
        ? undefined
        : q.assigneeId === "unassigned"
          ? null
          : q.assigneeId === "me"
            ? authOf(req).sub
            : q.assigneeId;
    res.json(await this.tickets.list({ ...q, assigneeId }));
  };

  getTicket = async (req: IdReq, res: Response) => {
    res.json(await this.tickets.get(req.params.id));
  };

  updateTicket = async (req: IdReq, res: Response) => {
    res.json(await this.tickets.update(req.params.id, validBody<UpdateTicketInput>(req)));
  };

  assignToMe = async (req: IdReq, res: Response) => {
    res.json(await this.tickets.assignToMe(req.params.id, authOf(req).sub));
  };

  addNote = async (req: IdReq, res: Response) => {
    const { body } = validBody<MessageBodyInput>(req);
    res.status(201).json(await this.tickets.addNote(req.params.id, authOf(req).sub, body));
  };

  draft = async (req: IdReq, res: Response) => {
    const { regenerate } = validBody<{ regenerate: boolean }>(req);
    // Always 200: an AI outage is reported in the body so the UI can fall back to manual replies.
    res.status(200).json(await this.drafts.getDraft(req.params.id, regenerate));
  };

  reply = async (req: IdReq, res: Response) => {
    const { body, status } = validBody<ReplyInput>(req);
    res.status(201).json(await this.tickets.reply(req.params.id, authOf(req).sub, body, status));
  };

  reclassify = async (req: IdReq, res: Response) => {
    res.status(202).json(await this.tickets.reclassify(req.params.id));
  };

  listAdmins = async (_req: Request, res: Response) => {
    res.json(await this.tickets.listAdmins());
  };
}
