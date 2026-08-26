import { MongoClient, ObjectId } from "mongodb";

const clientMap = {};
const connectMap = {};

function mongo(uri) {
  return clientMap[uri] ||= new MongoClient(uri);
}

/**
 * Connects the client for `uri` at most once, no matter how many Dao instances (or concurrent
 * requests on the same instance) ask -- every caller for the same uri awaits the same promise.
 * Assigning the promise itself (not its awaited result) before returning is what makes this
 * race-free: a second caller arriving before the first `connect()` settles still sees the
 * already-cached promise, because the assignment below never yields to the event loop.
 *
 * This matters beyond a redundant network call: MongoClient.connect() rejects when the server is
 * unreachable or incompatible, and calling it again concurrently on the same client while the
 * first attempt is still tearing down its topology can throw an uncaught MongoTopologyClosedError
 * that crashes the whole process, not just the one request.
 */
function connect(uri) {
  connectMap[uri] ??= mongo(uri).connect().catch((e) => {
    delete connectMap[uri]; // don't cache a failure forever -- let the next call retry
    throw e;
  });
  return connectMap[uri];
}

export { mongo, connect, ObjectId };
