class DaoError extends Error {
  constructor(msg, code, ...args) {
    super(msg, ...args);
    if (code) this.code = "caio-server-dao/" + code;
  }
}

module.exports = DaoError;
