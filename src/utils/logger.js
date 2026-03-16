const logger = {
  info(context, msg, data) {
    const ts = new Date().toISOString();
    const extra = data !== undefined ? ` | ${JSON.stringify(data)}` : '';
    console.log(`[${ts}] [INFO] [${context}] ${msg}${extra}`);
  },
  warn(context, msg, data) {
    const ts = new Date().toISOString();
    const extra = data !== undefined ? ` | ${JSON.stringify(data)}` : '';
    console.warn(`[${ts}] [WARN] [${context}] ${msg}${extra}`);
  },
  error(context, msg, err) {
    const ts = new Date().toISOString();
    const extra = err instanceof Error
      ? ` | ${err.message} | ${err.stack}`
      : err !== undefined ? ` | ${JSON.stringify(err)}` : '';
    console.error(`[${ts}] [ERROR] [${context}] ${msg}${extra}`);
  },
};

module.exports = logger;
