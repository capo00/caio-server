import { MongoClient, ObjectId } from "mongodb";

const clientMap = {};

function mongo(uri) {
  return clientMap[uri] ||= new MongoClient(uri);
}

export { mongo, ObjectId };
