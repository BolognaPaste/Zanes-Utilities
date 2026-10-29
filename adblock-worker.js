// Builds the ad-blocking engine from the downloaded filter lists on a worker thread (see parseOffThread in adblock.js)
// and sends it back serialized, the same bytes the saved engine file holds.
const { parentPort, workerData } = require('worker_threads');
const { FiltersEngine } = require(workerData.core);

const engine = FiltersEngine.parse(workerData.text, workerData.config);
if (workerData.resources !== undefined) engine.updateResources(workerData.resources, '' + workerData.resources.length);
parentPort.postMessage(engine.serialize());
