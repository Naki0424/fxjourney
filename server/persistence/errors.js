export class PersistenceError extends Error {
  constructor(message, { statusCode = 500, code = "PERSISTENCE_ERROR", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PersistenceError";
    this.statusCode = statusCode;
    this.code = code;
    this.scope = "persistence";
  }
}

export function badRequest(message, code = "INVALID_REQUEST") {
  return new PersistenceError(message, { statusCode: 400, code });
}

export function notFound(message, code = "NOT_FOUND") {
  return new PersistenceError(message, { statusCode: 404, code });
}

export function conflict(message, code = "CONFLICT") {
  return new PersistenceError(message, { statusCode: 409, code });
}

export function internalPersistenceError(message, cause) {
  return new PersistenceError(message, { statusCode: 500, code: "PERSISTENCE_FAILURE", cause });
}
