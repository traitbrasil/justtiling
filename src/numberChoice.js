// SPDX-License-Identifier: GPL-3.0-or-later
// A prefix waits briefly when both 1 and 10 (for example) are visible.
export class NumberChoice {
    constructor(count) { this.count = count; this.prefix = ''; }
    digit(value) {
        const next = this.prefix + value;
        const matches = Array.from({length: this.count}, (_, i) => String(i + 1))
            .filter(number => number.startsWith(next));
        if (!matches.length) return {number: null, wait: false};
        this.prefix = next;
        const number = Number(next);
        return {number: number <= this.count ? number : null, wait: matches.length > 1};
    }
}
