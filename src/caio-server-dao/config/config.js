const ssl = process.env.NODE_ENV === "production" ? "ssl=true&" : "";
const mongodbUri = process.env.MONGODB_URI ? process.env.MONGODB_URI + "?" + ssl + "retryWrites=true&w=majority" : undefined;

module.exports = {
  mongodbUri,
};
