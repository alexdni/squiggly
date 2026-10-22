/** An error whose message is safe and useful to show the AI client as-is. */
export class McpUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpUserError';
  }
}
