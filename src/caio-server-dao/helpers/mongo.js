const { MongoClient, ObjectId } = require("mongodb");

const clientMap = {};

function mongo(uri) {
  return clientMap[uri] ||= new MongoClient(uri);
}

module.exports = { mongo, ObjectId };
