/** A user-facing Jin error. The message is shown by the CLI and the desktop UI. */
export class JinError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "JinError"
  }
}
