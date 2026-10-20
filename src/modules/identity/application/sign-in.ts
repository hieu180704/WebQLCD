import type { Authenticator, Credentials, SignInResult } from "./ports";

export class SignIn {
  constructor(private readonly authenticator: Authenticator) {}

  execute(credentials: Credentials): Promise<SignInResult> {
    return this.authenticator.signIn(credentials);
  }
}
