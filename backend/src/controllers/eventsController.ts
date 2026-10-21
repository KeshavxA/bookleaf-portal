import type { Request, Response } from "express";
import type { SseHub } from "../realtime/sseHub";
import { authOf } from "../middleware/auth";

export class EventsController {
  constructor(private readonly hub: SseHub) {}

  stream = (req: Request, res: Response) => {
    this.hub.connect(authOf(req), res);
    // Connection stays open; the hub removes the client on 'close'.
  };
}
