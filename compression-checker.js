const fs = require('fs');
const child_process = require('child_process');

const ROM_PATH_US = '/Users/admin/nds/PMDSkyUS.nds';

async function main() {
    const links = require('./links.json');

    // Download each file
    for (const item of links) {
        const path = item.patch;
        const buffer = fs.readFileSync(path);

        // Check VCDIFF magic (0xD6C3C4)
        if (buffer[0] !== 0xD6 || buffer[1] !== 0xC3 || buffer[2] !== 0xC4) {
            throw new Error(`Invalid VCDIFF magic!`);
        }

        // Check if secondary compression is used
        const hdrIndicator = buffer[4];
        if (hdrIndicator & 0x1) {
            console.log('Re-compressing hack:', path);
            child_process.spawnSync('xdelta3', ['-d', '-s', ROM_PATH_US, path, 'temp.nds'], { stdio: 'inherit' });
            child_process.spawnSync('xdelta3', ['-e', '-S', '-f', '-s', ROM_PATH_US, 'temp.nds', path], { stdio: 'inherit' });
            fs.unlinkSync('temp.nds');
        }
    }
}

main().catch(console.error);