import links from './links.js';
import { readSaveData } from './pmd-save.js?v=2';
import { initSettingsView, isSettingsMenuOpen, keyboardMappings, loadKeyBindings } from './settings.js';

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

function isSaveDataGarbage(saveData) {
    // The game sometimes saves 0xff garbage data for some reason
    return saveData.length < 4 || (saveData[0] == 0xff && saveData[1] == 0xff && saveData[2] == 0xff && saveData[3] == 0xff);
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

async function selectAndReadFileAsArrayBuffer() {
    return new Promise((resolve, reject) => {
        const inputElement = document.createElement('input');
        inputElement.type = 'file';

        inputElement.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();

                reader.onload = function (e) {
                    resolve(e.target.result);
                };

                reader.onerror = function (e) {
                    reject(new Error("Error reading file: " + e));
                };

                reader.readAsArrayBuffer(file);
            } else {
                resolve(null);
            }
        });

        inputElement.click();
    });
}

function saveFile(bytes, name) {
    const link = document.createElement('a');
    link.href = createUrlFromBytes(bytes);
    link.download = name;
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

async function loadSaveData(gameId) {
    return localforage.getItem('save-' + gameId);
}

async function loadPlayer(url, gameId, name) {
    // Patch desmond's keymap
    desmondPatch();

    const background = document.querySelector('.background');
    background.classList.add('hidden');

    const playerContainer = document.getElementById('player-container');
    playerContainer.classList.remove('hidden');

    const saveData = await loadSaveData(gameId);

    const player = document.getElementById('player');
    player.loadURL(url, () => {
        // Load the save data
        if (saveData) {
            Module.HEAPU8.set(saveData, Module._savGetPointer(saveData.length))
            Module._savUpdateChangeFlag();
            console.log('Loaded save data');
        }
    });

    document.title = `${name} - EoS Hack Player`;

    document.getElementById('settings').addEventListener('click', () => {
        const settings = document.getElementById('settings-menu');
        settings.classList.remove('hidden');
    });

    document.getElementById('back').addEventListener('click', () => {
        window.location.reload();
    });

    document.getElementById('save-backup').addEventListener('click', () => {
        const size = Module._savGetSize();
        if (size == 0) {
            alert('No save data found, please save your game first.');
            return;
        }

        const ptr = Module._savGetPointer(0);
        const buffer = new Uint8Array(size);
        buffer.set(Module.HEAPU8.subarray(ptr, ptr + size));
        if (isSaveDataGarbage(buffer)) {
            alert('No save data found, please save your game first.');
            return;
        }

        saveFile(buffer, name + '.sav');
    });

    const toggleFastForward = document.getElementById('toggle-fastforward');
    toggleFastForward.addEventListener('click', () => {
        const isFastForward = globalThis.config.powerSave;
        if (isFastForward) {
            globalThis.config.powerSave = false;
            toggleFastForward.querySelector('span').innerHTML = 'play_arrow';
        } else {
            globalThis.config.powerSave = true;
            toggleFastForward.querySelector('span').innerHTML = 'fast_forward';
        }
    });

    let previousSaveFlag = 0;

    setInterval(() => {
        // Logic adapted from desmond.js `checkSaveGame` function
        const saveFlag = Module._savUpdateChangeFlag();
        if (saveFlag == 0 && previousSaveFlag == 1) {
            console.log('Save detected');

            const size = Module._savGetSize();
            const ptr = Module._savGetPointer(0);
            const buffer = new Uint8Array(size);
            buffer.set(Module.HEAPU8.subarray(ptr, ptr + size));

            // The game sometimes saves 0xff garbage data for some reason
            if (size > 0 && !isSaveDataGarbage(buffer)) {
                // desmond.js auto-loads a save file with this naming convention
                localforage.setItem('save-' + gameId, buffer).then(() => {
                    console.log('Game saved.');
                });
            }
        }
        previousSaveFlag = saveFlag;
    }, 1000);
}

async function createPatchSelect(links) {
    const select = document.getElementById('patch-select');
    select.innerHTML = '';

    for (const [i, link] of links.entries()) {
        const option = document.createElement('option');
        option.value = i;
        option.innerText = link.name;
        select.appendChild(option);
    }
}

async function patchRom(link, region, validationSha1, button, rom) {
    const patchUrl = link.patch;
    const patchRegion = link.region ?? 'us';

    button.innerText = 'Patching (1/7)...';
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

async function readRomFile(file) {
    const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = evt => resolve(new Uint8Array(evt.target.result));
        reader.onerror = error => reject(error);
        reader.readAsArrayBuffer(file);
    });

    const rom = {
        name: file.name,
        data
    };

    console.log(`Loaded ROM: ${rom.name}`);
    return rom;
}

async function cacheRom(file) {
    console.log('Caching ROM...');
    await localforage.setItem('cached-rom', file);
}

async function clearCachedRom() {
    console.log('Clearing cached ROM...');
    await localforage.removeItem('cached-rom');
}

async function loadCachedRom() {
    const rom = await localforage.getItem('cached-rom');
    if (!rom) return null;

    const inputWrapper = document.getElementById('rom-input-wrapper');
    const loadedRomElem = document.getElementById('loaded-rom');

    document.getElementById('rom-name').textContent = rom.name;
    inputWrapper.classList.add('hidden');
    loadedRomElem.classList.remove('hidden');

    document.getElementById('play-button').disabled = false;
    document.getElementById('save-button').disabled = false;

    return rom;
}

async function sha1(arrayBuffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-1', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

document.addEventListener('DOMContentLoaded', () => {
    createPatchSelect(links);

    const inputWrapper = document.getElementById('rom-input-wrapper');
    const loadedRomElem = document.getElementById('loaded-rom');

    const fileInput = document.getElementById('rom-file');
    const removeRomButton = document.getElementById('remove-rom');
    const playButton = document.getElementById('play-button');
    const saveButton = document.getElementById('save-button');
    const inProgressButton = document.getElementById('in-progress');

    const params = new URLSearchParams(window.location.search);

    const region = params.get('region') || 'us';
    const validationSha1 = params.get('sha1');

    let romFile = null;

    fileInput.addEventListener('change', async () => {
        if (!fileInput.files
            || !fileInput.files.length
            || !fileInput.files[0].name.endsWith('.nds')
        ) {
            return;
        }
        fileInput.disabled = true;

        const file = fileInput.files[0];
        romFile = await readRomFile(file);
        await cacheRom(romFile);
        document.getElementById('rom-name').textContent = romFile.name;
        inputWrapper.classList.add('hidden');
        loadedRomElem.classList.remove('hidden');

        playButton.disabled = false;
        saveButton.disabled = false;
    });

    removeRomButton.addEventListener('click', () => {
        romFile = null;
        fileInput.value = '';
        fileInput.disabled = false;
        inputWrapper.classList.remove('hidden');
        loadedRomElem.classList.add('hidden');

        playButton.disabled = true;
        saveButton.disabled = true;

        clearCachedRom();
    });

    const onClick = async (shouldPlay) => {
        playButton.classList.add('hidden');
        saveButton.classList.add('hidden');
        inProgressButton.classList.remove('hidden');
        removeError();

        try {
            const patchIndex = parseInt(document.getElementById('patch-select').value);
            const link = links[patchIndex];

            const patchedRom = await patchRom(link, region, validationSha1, inProgressButton, romFile.data);

            if (shouldPlay) {
                const url = createUrlFromBytes(patchedRom);
                await loadPlayer(url, link.id, link.name);
            } else {
                saveFile(patchedRom, link.name + '.nds');
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

    loadKeyBindings();
    initSettingsView();

    document.getElementById('fullscreen').addEventListener('click', () => {
        const player = document.getElementById('player-container');
        if (player.webkitRequestFullscreen) {
            player.webkitRequestFullscreen();
        } else if (player.requestFullscreen) {
            player.requestFullscreen();
        }
    });

    document.getElementById('patch-select').addEventListener('change', async () => {
        const patch = selectedHack();
        if (patch) {
            localStorage.setItem('last-patch', patch.id);
        }
        await updateHackInfo();
    });

    const lastPatch = localStorage.getItem('last-patch');
    if (lastPatch) {
        const patchIndex = links.findIndex(link => link.id === lastPatch);
        if (patchIndex >= 0) {
            document.getElementById('patch-select').value = patchIndex;
        }
    }
    loadCachedRom().then(file => {
        if (file) {
            romFile = file;
        }
    });

    updateHackInfo(); // Update the hack info on page load

    document.getElementById('load-save').addEventListener('click', async () => {
        const file = await selectAndReadFileAsArrayBuffer();
        if (!file) return;

        const selectedPatchIndex = parseInt(document.getElementById('patch-select').value);
        const selectedPatch = links[selectedPatchIndex];

        try {
            if (isSaveDataGarbage(file)) {
                throw new Error('The provided save file is invalid.');
            }

            const saveData = readSaveData(file);
            console.log('Read save data:', saveData);

            const saveDataBuffer = new Uint8Array(file);
            await localforage.setItem('save-' + selectedPatch.id, saveDataBuffer);
            console.log('Stored save data.');

            await updateHackInfo();
        } catch (e) {
            reportError(e);
        }
    });

    document.getElementById('export-save').addEventListener('click', async () => {
        const selectedPatchIndex = parseInt(document.getElementById('patch-select').value);
        const selectedPatch = links[selectedPatchIndex];

        const saveDataBuffer = await loadSaveData(selectedPatch.id);
        if (!saveDataBuffer || isSaveDataGarbage(saveDataBuffer)) {
            alert('No save data found, please save your game first.');
            return;
        }

        saveFile(saveDataBuffer, selectedPatch.name + '.sav');
    });

    document.getElementById('delete-save').addEventListener('click', async () => {
        const selectedPatchIndex = parseInt(document.getElementById('patch-select').value);
        const selectedPatch = links[selectedPatchIndex];

        if (confirm(`Are you sure you want to delete the save data for ${selectedPatch.name}?`)) {
            await localforage.removeItem('save-' + selectedPatch.id);
            await updateHackInfo();
        }
    });
});

function selectedHack() {
    const patchIndex = parseInt(document.getElementById('patch-select').value);
    return links[patchIndex];
}

async function updateHackInfo() {
    const selectedPatch = selectedHack();
    document.getElementById('hack-info').classList.remove('hidden');

    const hackNameElement = document.getElementById('hack-name');
    const hackAuthorElement = document.getElementById('hack-author');
    const hackLinkElement = document.getElementById('hack-link');
    const noHackLinkElement = document.getElementById('no-hack-link');

    const exportSaveButton = document.getElementById('export-save');
    const deleteSaveButton = document.getElementById('delete-save');

    hackNameElement.textContent = selectedPatch.name;
    hackAuthorElement.textContent = 'by ' + selectedPatch.author;

    const saveInfoElement = document.getElementById('save-info');
    const noSaveElement = document.getElementById('no-save');
    saveInfoElement.classList.add('hidden');
    noSaveElement.classList.add('hidden');
    exportSaveButton.classList.add('hidden');
    deleteSaveButton.classList.add('hidden');

    if (selectedPatch.page) {
        hackLinkElement.href = selectedPatch.page;
        hackLinkElement.classList.remove('hidden');
        noHackLinkElement.classList.add('hidden');
    } else {
        hackLinkElement.classList.add('hidden');
        noHackLinkElement.classList.remove('hidden');
    }

    // Update save info
    const saveDataBuffer = await loadSaveData(selectedPatch.id);
    saveInfoElement.classList.remove('hidden');

    if (saveDataBuffer && !isSaveDataGarbage(saveDataBuffer)) {
        try {
            const saveData = readSaveData(saveDataBuffer);
            console.log('Read save data:', saveData);

            noSaveElement.classList.add('hidden');
            saveInfoElement.classList.remove('hidden');

            document.getElementById('save-hero-name').textContent = saveData.heroName || 'No hero name';
            document.getElementById('save-team-name').textContent = saveData.teamName || 'No team name';

            const playTimeInSeconds = saveData.playTimeInSeconds || 0;
            let hours = Math.floor(playTimeInSeconds / 3600);
            if (hours < 10) hours = '0' + hours;
            let minutes = Math.floor((playTimeInSeconds % 3600) / 60);
            if (minutes < 10) minutes = '0' + minutes;
            let seconds = Math.floor(playTimeInSeconds % 60);
            if (seconds < 10) seconds = '0' + seconds;
            document.getElementById('save-playtime').textContent = `${hours}:${minutes}:${seconds}`;

            const adventures = saveData.numberOfAdventures || 0;
            document.getElementById('save-adventures').textContent = adventures + ' adventure' + (adventures === 1 ? '' : 's');

            exportSaveButton.classList.remove('hidden');
            deleteSaveButton.classList.remove('hidden');
        } catch (e) {
            reportError(e);
        }

    } else {
        noSaveElement.classList.remove('hidden');
        saveInfoElement.classList.add('hidden');
    }
}

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
        if (!emuIsRunning || isSettingsMenuOpen()) {
            return;
        }
        var isDown = (e.type === "keydown");
        var k = convertKey(e.key);
        if (k >= 0) {
            emuKeyState[k] = isDown;
            e.preventDefault();
        }
        if (e.keyCode == 27) {
            uiSwitchTo('menu');
        }
    }
}

function convertKey(keyCode) {
    for (var i = 0; i < keyboardMappings.length; i++) {
        if (keyCode == keyboardMappings[i]) {
            return i;
        }
    }
    return -1;
}
