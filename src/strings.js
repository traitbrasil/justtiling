// SPDX-License-Identifier: GPL-3.0-or-later
// Pure marker and formatter: the controller and layout remain GI-independent.
export function N_(message) { return message; }
export function format(message, ...values) {
    let index = 0;
    return message.replace(/%%|%s/g, token => token === '%%' ? '%' : String(values[index++]));
}
