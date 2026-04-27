export class DoError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

export class VaultNotFound extends DoError {
  constructor(path: string) {
    super(`vault not found: ${path}`, 'VaultNotFound')
  }
}

export class InvalidSlug extends DoError {
  constructor(slug: string) {
    super(`invalid slug '${slug}': must match [a-z0-9][a-z0-9.-]*`, 'InvalidSlug')
  }
}

export class ProjectNotFound extends DoError {
  constructor(slug: string) {
    super(`project '${slug}' not found`, 'ProjectNotFound')
  }
}

export class ProjectAlreadyExists extends DoError {
  constructor(slug: string) {
    super(`project '${slug}' already exists`, 'ProjectAlreadyExists')
  }
}

export class InvalidRef extends DoError {
  constructor(ref: string) {
    super(`invalid ref '${ref}': expected <slug>#<index>`, 'InvalidRef')
  }
}

export class IndexOutOfRange extends DoError {
  constructor(index: number, slug: string, count: number) {
    super(
      `index ${index} out of range (project '${slug}' has ${count} task${count === 1 ? '' : 's'})`,
      'IndexOutOfRange',
    )
  }
}

export class InvalidDate extends DoError {
  constructor(value: string) {
    super(`invalid date '${value}': expected YYYY-MM-DD`, 'InvalidDate')
  }
}

export class NothingToEdit extends DoError {
  constructor() {
    super(
      'nothing to edit: pass at least one of --title, --due, --project',
      'NothingToEdit',
    )
  }
}

export class MalformedProject extends DoError {
  constructor(slug: string, reason: string) {
    super(`project '${slug}' is malformed: ${reason}`, 'MalformedProject')
  }
}
