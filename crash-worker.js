// Runs the crash analyzer (crash-core.js) on its own thread so reading and scanning a large file never freezes the
// window. app.js posts one File at a time and gets back the same result object scanFile returns on the page.
self.importScripts('crash-core.js');
self.onmessage = async e => self.postMessage(await scanFile(e.data));
