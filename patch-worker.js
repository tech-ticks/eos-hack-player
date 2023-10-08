importScripts('vendor/vcdiff.js');

self.onmessage = function (e) {
    const { invocationId, romBytes, patchBytes } = e.data;

    console.log('Received invocationId:', invocationId);

    const romFile = new MarcFile(romBytes);
    const patchFile = new MarcFile(patchBytes);
    const data = new VCDIFF(patchFile).apply(romFile)._u8array;

    self.postMessage({ invocationId, data });
};
