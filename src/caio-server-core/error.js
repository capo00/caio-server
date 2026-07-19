class AppError extends Error {
  constructor(msg, { cause, code, paramMap, dtoOut, message, status = 500 } = {}) {
    super(message ?? msg, { cause });
    this.code = code;
    this.paramMap = paramMap;
    this.dtoOut = dtoOut;
    this.status = status;
    this.cause = cause;
  }

  toObject() {
    return {
      message: this.message,
      code: this.code,
      paramMap: this.paramMap,
      dtoOut: this.dtoOut,
      ...(this.cause ? { cause: this.cause.toObject?.() ?? { message: this.cause.message } } : null),
    }
  }
}

AppError.DoesNotExists = class extends AppError {
  constructor(msg, { codePrefix, ...opts } = {}) {
    super(msg, { code: codePrefix + "/doesNotExist", ...opts, status: 404 });
  }
};

AppError.Failed = class extends AppError {
  constructor(msg, opts) {
    super(msg, { status: 500, ...opts });
  }
};

module.exports = AppError;
