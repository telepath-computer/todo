export class DoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class NotFound extends DoError {}
export class NothingToEdit extends DoError {}
export class InvalidArgument extends DoError {}
export class InvalidDate extends DoError {
  constructor(input: string) {
    super(`could not parse date: ${input}`)
  }
}
