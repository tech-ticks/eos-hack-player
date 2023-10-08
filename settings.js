export const KEY_INDICES = Object.freeze({
    'right': 0,
    'left': 1,
    'down': 2,
    'up': 3,
    'select': 4,
    'start': 5,
    'b': 6,
    'a': 7,
    'y': 8,
    'x': 9,
    'l': 10,
    'r': 11,
    'debug': 12,
    'lid': 13,
    'save-state': 14,
    'load-state': 15,
    'fast-forward': 16,
});

export const DEFAULT_KEYBOARD_BINDINGS = [
    'ArrowRight', // Right
    'ArrowLeft',  // Left
    'ArrowDown',  // Down
    'ArrowUp',    // Up
    'Shift',      // Select (mapped to Shift)
    'Enter',      // Start (mapped to Enter)
    'z',          // B (mapped to Z)
    'x',          // A (mapped to X)
    'a',          // Y (mapped to A)
    's',          // X (mapped to S)
    'q',          // L (mapped to Q)
    'w',          // R (mapped to W)
    undefined,    // Debug button
    undefined,    // Lid
    undefined,    // Save state
    undefined,    // Load state
    undefined,    // Toggle speed-up
];

export const keyboardMappings = [...DEFAULT_KEYBOARD_BINDINGS];

export function loadKeyBindings() {
    // Load keyboard mappings from local storage at initialization.
    const storedMappings = localStorage.getItem('keyboardMappings');
    if (storedMappings) {
        const parsedMappings = JSON.parse(storedMappings);
        if (Array.isArray(parsedMappings) && parsedMappings.length === DEFAULT_KEYBOARD_BINDINGS.length) {
            keyboardMappings.splice(0, keyboardMappings.length, ...parsedMappings);
        }
    }
}

export function saveKeyBindings() {
    // Save keyboard mappings to local storage.
    localStorage.setItem('keyboardMappings', JSON.stringify(keyboardMappings));
}

export function isSettingsMenuOpen() {
    return !document.getElementById('settings-menu').classList.contains('hidden');
}

export function initSettingsView() {
    const allKeyButtons = document.getElementsByClassName('key-button');
    const closeButton = document.getElementById('close-settings');
    const resetButton = document.getElementById('reset-keys');

    for (const [key, value] of Object.entries(KEY_INDICES)) {
        const keyElement = document.getElementById('button-' + key);
        keyElement.innerText = keyboardMappings[value] ?? '(Disabled)';
        let isActive = false;
        let onKeyDown;

        keyElement.addEventListener('click', () => {
            if (isActive) {
                // Deactivate
                document.removeEventListener('keydown', onKeyDown);
                keyElement.classList.remove('active');
                keyElement.innerText = keyboardMappings[value] ?? '(Disabled)';
                for (const button of allKeyButtons) {
                    button.disabled = false;
                }
                closeButton.disabled = false;
            } else {
                // Activate
                keyElement.classList.add('active');
                keyElement.innerText = 'Press any key...';

                for (const button of allKeyButtons) {
                    if (button === keyElement) continue;
                    button.disabled = true;
                }
                closeButton.disabled = true;

                onKeyDown = (e) => {
                    keyElement.innerText = e.key;

                    keyboardMappings[value] = e.key;
                    saveKeyBindings();

                    document.removeEventListener('keydown', onKeyDown);
                    keyElement.classList.remove('active');

                    for (const button of allKeyButtons) {
                        button.disabled = false;
                    }
                    closeButton.disabled = false;
                    isActive = false;
                };

                document.addEventListener('keydown', onKeyDown);
            }

            isActive = !isActive;
        });
    }

    closeButton.addEventListener('click', () => {
        document.getElementById('settings-menu').classList.add('hidden');
    });

    resetButton.addEventListener('click', () => {
        if (!confirm('Are you sure you want to reset all key bindings?')) {
            return;
        }

        keyboardMappings.splice(0, keyboardMappings.length, ...DEFAULT_KEYBOARD_BINDINGS);
        saveKeyBindings();

        for (const [key, value] of Object.entries(KEY_INDICES)) {
            const keyElement = document.getElementById('button-' + key);
            keyElement.innerText = keyboardMappings[value] ?? '(Disabled)';
        }
    });
}
