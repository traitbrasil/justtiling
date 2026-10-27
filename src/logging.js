// SPDX-License-Identifier: GPL-3.0-or-later
// Keep diagnostic events on one bounded line, including exception messages.
export function safeLogText(value) {
    return String(value).slice(0, 8192).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,
        char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
