
async function main() {
    const links = require('./links.json');

    // Download each file
    for (const item of links) {
        const link = item.patch;
        const response = await fetch(link);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        // Check VCDIFF magic (0xD6C3C4)
        if (buffer[0] !== 0xD6 || buffer[1] !== 0xC3 || buffer[2] !== 0xC4) {
            throw new Error(`Invalid VCDIFF magic!`);
        }

        // Check if secondary compression is used
        const hdrIndicator = buffer[4];
        if (hdrIndicator & 0x1) {
            // Skip the file if secondary compression is used
            console.log('Hack uses secondary compression:', link);
            links.splice(links.indexOf(link), 1);
        }
    }
}

main().catch(console.error);