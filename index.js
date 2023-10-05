import links from './links.js';

const CLEAN_US_SHA1 = '5fa96ca8d8dd6405d6cd2bad73ed68bc73a9d152';
const CLEAN_EU_SHA1 = 'c838a5adf1ed32d2da8454976e5b1a1aa189c139';

class UserError extends Error { }
class HttpStatusError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}

async function downloadPatch(url, defaultRegion) {
    console.log(`Downloading patch '${url}'...`)

    const result = await fetch(url);
    if (!result.ok) {
        throw new HttpStatusError(`Failed to fetch patch '${url} (code ${result.status})'`, result.status);
    }

    const patch = new Uint8Array(await result.arrayBuffer());

    // The region header, if set, has priority over the region passed as a query parameter.
    const region = result.headers['X-SkyTemple-Region'] || defaultRegion;
    return { patch, region };
}

function applyPatch(romBytes, patchBytes) {
    console.log('Applying the patch...');

    const romFile = new MarcFile(romBytes);
    const patchFile = new MarcFile(patchBytes);
    return new VCDIFF(patchFile).apply(romFile)._u8array;
}

async function ensureCleanRom(rom, romRegion) {
    const expectedSha1 = getCleanSha1ForRegion(romRegion);
    const romSha1 = await sha1(rom);
    console.log(`[cleaning] ROM sha1: ${romSha1}, expected sha1: ${expectedSha1}`);

    if (expectedSha1 !== romSha1) {
        try {
            const { patch } = await downloadPatch(`patches/${romRegion}/from/${romSha1.toUpperCase()}.xdelta`);
            return applyPatch(rom, patch);
        } catch (e) {
            if (e instanceof HttpStatusError && e.statusCode == 404) {
                // An unsupported dump was provided if no patch was found
                throw new UserError(`The provided ROM is incompatible. Please try again with a clean ROM. (Checksum of the provided ROM: "${romSha1}")`);
            } else {
                throw e;
            }
        }
    } else {
        return rom;
    }
}

async function ensureExpectedRegion(rom, romRegion, expectedRegion) {
    console.log(`ROM region: ${romRegion}, expected region: ${expectedRegion}`);

    if (romRegion !== expectedRegion) {
        const { patch } = await downloadPatch(`patches/${romRegion}-to-${expectedRegion}.xdelta`);
        return applyPatch(rom, patch);
    } else {
        return rom;
    }
}

function getAndCheckRomRegion(rom) {
    // Read ROM region from gamecode (see http://problemkaputt.de/gbatek.htm#dscartridgeheader)
    const regionCode = String.fromCharCode(rom[0xF]);
    if (regionCode === 'E') { // US ("English")
        return 'us';
    } else if (regionCode === 'P') { // Europe
        return 'eu';
    } else if (regionCode === 'J') { // Japan
        return 'jp';
    } else {
        throw new UserError('The region of your ROM is not supported. Only US, EU and Japanese roms are currently supported.');
    }
}

function saveFile(bytes, name) {
    const link = document.createElement('a');
    link.href = createUrlFromBytes(bytes);
    link.download = `${name || 'patched'}.nds`;
    link.click();

    URL.revokeObjectURL(link.href);
}

function createUrlFromBytes(bytes) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    return URL.createObjectURL(blob);
}

function getCleanSha1ForRegion(region) {
    return region === 'us' ? CLEAN_US_SHA1 : CLEAN_EU_SHA1;
}

function getFileNameFromUrl(url) {
    const lastSegment = url.includes('/') ? url.split('/').pop() : url;

    // Return the file name without extension
    return lastSegment.includes('.')
        ? lastSegment.substr(0, lastSegment.lastIndexOf('.'))
        : lastSegment;
}

function reportError(error) {
    let text = '';
    if (error.message && error.message.includes('not implemented')) {
        // "Not implemented" error from the VCDiff library
        text = 'This patch is not supported. Please ask the ROM hack author to provide a compatible patch and include the error details below:<br><br>';
    } else if (!(error instanceof UserError)) {
        text = 'An error occured.<br><br>';
    }

    for (const errorElem of document.querySelectorAll('.error')) {
        errorElem.innerHTML = `${text}${error}`;
    }
}

function removeError() {
    for (const errorElem of document.querySelectorAll('.error')) {
        errorElem.innerHTML = '';
    }
}

function loadPlayer(url, name) {
    // Patch desmond's keymap
    desmondPatch();

    const background = document.querySelector('.background');
    background.classList.add('hidden');

    const playerContainer = document.getElementById('player-container');
    playerContainer.classList.remove('hidden');

    const player = document.getElementById('player');
    player.loadURL(url);

    document.title = `${name} - EoS Hack Player`;
}

async function createPatchSelect(links) {
    const select = document.getElementById('patch-select');
    select.innerHTML = '';

    for (const [i, link] of links.entries()) {
        const option = document.createElement('option');
        option.value = i;
        option.innerText = `${link.name} (by ${link.author})`;
        select.appendChild(option);
    }
}

async function patchRom(link, region, validationSha1, button, file) {
    const patchUrl = link.patch;
    const patchRegion = link.region ?? 'us';

    button.innerText = 'Patching (1/7)...';

    const reader = new FileReader();
    const readPromise = new Promise((resolve, reject) => {
        reader.onload = evt => resolve(new Uint8Array(evt.target.result));
        reader.onerror = error => reject(error);
    });

    reader.readAsArrayBuffer(file);

    const rom = await readPromise;

    let patch;
    if (patchUrl) {
        button.innerText = 'Patching (2/7)...';
        const result = await downloadPatch(patchUrl, region);
        patch = result.patch;
    }

    button.innerText = 'Patching (3/7)...';
    const romRegion = getAndCheckRomRegion(rom);
    const cleanRom = await ensureCleanRom(rom, romRegion);

    let patchedRom = cleanRom;
    let expectedSha1;
    if (patchUrl) {
        button.innerText = 'Patching (4/7)...';
        const romInExpectedRegion = await ensureExpectedRegion(cleanRom, romRegion, patchRegion);

        button.innerText = 'Patching (5/7)...';
        await new Promise(resolve => setTimeout(resolve, 20)); // Update the UI

        expectedSha1 = getCleanSha1ForRegion(patchRegion);
        console.log(`Validating checksum against clean SHA - 1 "${expectedSha1}"`);
        const romSha1 = await sha1(romInExpectedRegion);
        if (romSha1 !== expectedSha1) {
            throw new Error(`Failed to clean rom or transition region(checksum mismatch: ${romSha1})`);
        }

        button.innerText = 'Patching (6/7)...';
        await new Promise(resolve => setTimeout(resolve, 20)); // Update the UI

        console.log('Applying the ROM hack patch...');
        patchedRom = applyPatch(romInExpectedRegion, patch);
    }

    if (validationSha1) {
        button.innerText = 'Patching (7/7)...';
        console.log(`Validating checksum against user - provided validation SHA - 1 "${expectedSha1}"`);
        const patchedRomSha1 = await sha1(patchedRom);
        if (patchedRomSha1 !== validationSha1.toLowerCase()) {
            throw new Error(`Failed to patch ROM(checksum mismatch: ${patchedRomSha1})`);
        }
    }

    return patchedRom;
}

async function sha1(arrayBuffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-1', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

document.addEventListener('DOMContentLoaded', () => {
    createPatchSelect(links);

    const fileInput = document.getElementById('rom-file');
    const playButton = document.getElementById('play-button');
    const saveButton = document.getElementById('save-button');
    const inProgressButton = document.getElementById('in-progress');

    const params = new URLSearchParams(window.location.search);

    const region = params.get('region') || 'us';
    const validationSha1 = params.get('sha1');

    fileInput.addEventListener('change', () => {
        const disabled = !fileInput.files
            || !fileInput.files.length
            || !fileInput.files[0].name.endsWith('.nds');

        playButton.disabled = disabled;
        saveButton.disabled = disabled;
    });

    document.getElementById('fullscreen').addEventListener('click', () => {
        const player = document.getElementById('player-container');
        if (player.webkitRequestFullscreen) {
            player.webkitRequestFullscreen();
        } else if (player.requestFullscreen) {
            player.requestFullscreen();
        }
    });

    const onClick = async (shouldPlay) => {
        playButton.classList.add('hidden');
        saveButton.classList.add('hidden');
        inProgressButton.classList.remove('hidden');
        removeError();

        try {
            const patchIndex = parseInt(document.getElementById('patch-select').value);
            const link = links[patchIndex];

            const patchedRom = await patchRom(link, region, validationSha1, inProgressButton, fileInput.files[0]);

            if (shouldPlay) {
                const url = createUrlFromBytes(patchedRom);
                loadPlayer(url, link.name);
            } else {
                saveFile(patchedRom, getFileNameFromUrl(link.patch));
            }
        } catch (e) {
            reportError(e);
            console.error(e);
        } finally {
            playButton.classList.remove('hidden');
            saveButton.classList.remove('hidden');
            inProgressButton.classList.add('hidden');
        }
    };

    playButton.addEventListener('click', async () => {
        await onClick(true);
    });
    saveButton.addEventListener('click', async () => {
        await onClick(false);
    });
});

document.addEventListener('fullscreenchange', onFullScreenChange);
document.addEventListener('webkitfullscreenchange', onFullScreenChange);

function onFullScreenChange() {
    if (document.fullscreenElement) {
        document.querySelector('.controls').classList.add('hidden');
    } else {
        document.querySelector('.controls').classList.remove('hidden');
    }
}

// Replace Desmond's keymap
function desmondPatch() {
    window.onkeydown = window.onkeyup = (e) => {
        // Copied from Desmond library code
        if (!emuIsRunning) {
            return
        }
        e.preventDefault()
        var isDown = (e.type === "keydown")
        var k = convertKeyCode(e.keyCode)
        if (k >= 0) {
            emuKeyState[k] = isDown
        }
        if (e.keyCode == 27) {
            uiSwitchTo('menu')
        }
    }
}

function convertKeyCode(keyCode) {
    const keyboardMappings = [
        39,
        37,
        40,
        38,
        16,
        13,
        90,
        88,
        65,
        83,
        81,
        87,
        -1, // Debug button
        8
    ];

    for (var i = 0; i < 14; i++) {
        if (keyCode == keyboardMappings[i]) {
            return i
        }
    }
    return -1
}
