// Sources: https://projectpokemon.org/home/docs/mystery-dungeon-nds/explorers-of-sky-save-structure-r62/
// and https://github.com/evandixon/SkyEditor.SaveEditor/blob/master/SkyEditor.SaveEditor/MysteryDungeon/Explorers/SkySave.cs
/**
 * @param {Uint8Array} buffer 
 */
export function readSaveData(buffer) {
    const heroName = decodeAndCleanString(buffer, 0x13f, 10);
    const partnerName = decodeAndCleanString(buffer, 0x149, 0x149, 10);
    const teamName = decodeAndCleanString(buffer, 0x994e, 10);
    const numberOfAdventures = read32BitInteger(buffer, 0x8B70);
    const playTimeInOne64thSeconds = read32BitInteger(buffer, 0x9960);
    const playTimeInSeconds = playTimeInOne64thSeconds / 64;

    return {
        heroName,
        partnerName,
        teamName,
        numberOfAdventures,
        playTimeInSeconds
    };
}

function read32BitInteger(buffer, offset) {
    return buffer[offset] | buffer[offset + 1] << 8 | buffer[offset + 2] << 16 | buffer[offset + 3] << 24;
}

function read16BitInteger(buffer, offset) {
    return buffer[offset] | buffer[offset + 1] << 8;
}

function decodeAndCleanString(buffer, start, length) {
    const decoder = new TextDecoder('windows-1252');
    return decoder.decode(buffer.slice(start, start + length)).replace(/\0/g, '');
}