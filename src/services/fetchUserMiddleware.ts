import { TurnContext, TeamsInfo } from 'botbuilder';
import { UserService } from './userService';
import { memberVerdict } from './memberGate';

export class FetchUserMiddleware {
  private userService: UserService;

  constructor(userService: UserService) {
    this.userService = userService;
  }

  async onTurn(context: TurnContext, next: () => Promise<void>): Promise<void> {
    // A proactive turn - CloudAdapter.createConversationAsync, used to open a
    // recipient's 1:1 chat - runs this whole pipeline against a synthetic
    // createConversation event that carries a recipient but no `from`.
    // Without this guard `context.activity.from.id` below throws a TypeError,
    // the adapter's onTurnError apologises to the recipient, and the send
    // never happens. There is no member to resolve on such a turn, and
    // nothing downstream reads turnState 'user' on it. (Same guard as
    // PR #256, which opens 1:1 chats for the zap-message action.)
    if (!context.activity?.from?.id) {
      await next();
      return;
    }

    // Check if user is already stored in the turn state (for the current turn)
    if (!context.turnState.get('user')) {
      console.log("User not found in turn state. Fetching user's info ...");
      let member;
      try {
        member = await TeamsInfo.getMember(context, context.activity.from.id);
      } catch (error) {
        // Nobody we can name is nobody we serve. Ending the turn quietly here
        // keeps onTurnError from apologising to someone outside the org.
        console.warn(
          'Ignoring a turn whose sender Teams would not resolve:',
          error instanceof Error ? error.message : String(error),
        );
        return;
      }

      // Members of this bot's own tenant only: no LNbits account, no reply
      // and no error message for a guest or anyone else (see memberGate.ts).
      const verdict = memberVerdict(member);
      if (verdict.allowed === false) {
        console.info(`Ignoring a turn from a non-member (${verdict.reason}).`);
        return;
      }

      const userService = UserService.getInstance();
      const user = await userService.ensureUserSetup(member);
      context.turnState.set('user', user); // Store user in turn state for this turn
    }

    // Continue with the next middleware or bot logic
    await next();
  }
}
