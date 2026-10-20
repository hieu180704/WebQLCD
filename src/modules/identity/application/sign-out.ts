import type { Authenticator } from "./ports";

export class SignOut {
  constructor(private readonly authenticator: Authenticator) {}

  execute(): Promise<void> {
    return this.authenticator.signOut();
  }
}
