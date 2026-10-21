import type { Request, Response } from "express";
import type { AuthService } from "../services/authService";
import { authOf } from "../middleware/auth";
import { validBody } from "../middleware/validate";
import type { LoginInput } from "../schemas/authSchemas";

export class AuthController {
  constructor(private readonly auth: AuthService) {}

  login = async (req: Request, res: Response) => {
    const { email, password } = validBody<LoginInput>(req);
    res.json(await this.auth.login(email, password));
  };

  me = async (req: Request, res: Response) => {
    res.json(await this.auth.me(authOf(req).sub));
  };
}
