'use strict';

const Path = require('path');
const FileConfig = require(Path.resolve('joi-pt-br.config.js'));
const Hoek = require('@hapi/hoek');

const Template = require('./template');


const internals = {};


exports.compile = function (messages, target) {

    // Single value string ('plain error message', 'template {error} message')

    if (typeof messages === 'string') {
        Hoek.assert(!target, 'Cannot set single message string');
        return new Template(messages);
    }

    // Single value template

    if (Template.isTemplate(messages)) {
        Hoek.assert(!target, 'Cannot set single message template');
        return messages;
    }

    // By error code { 'number.min': <string | template> }

    Hoek.assert(typeof messages === 'object' && !Array.isArray(messages), 'Invalid message options');

    target = target ? Hoek.clone(target) : {};

    for (let code in messages) {
        const message = messages[code];

        if (code === 'root' ||
            Template.isTemplate(message)) {

            target[code] = message;
            continue;
        }

        if (typeof message === 'string') {
            target[code] = new Template(message);
            continue;
        }

        // By language { english: { 'number.min': <string | template> } }

        Hoek.assert(typeof message === 'object' && !Array.isArray(message), 'Invalid message for', code);

        const language = code;
        target[language] = target[language] || {};

        for (code in message) {
            const localized = message[code];

            if (code === 'root' ||
                Template.isTemplate(localized)) {

                target[language][code] = localized;
                continue;
            }

            Hoek.assert(typeof localized === 'string', 'Invalid message for', code, 'in', language);
            target[language][code] = new Template(localized);
        }
    }

    return target;
};


exports.decompile = function (messages) {

    // By error code { 'number.min': <string | template> }

    const target = {};
    for (let code in messages) {
        const message = messages[code];

        if (code === 'root') {
            target[code] = message;
            continue;
        }

        if (Template.isTemplate(message)) {
            target[code] = message.source;
            continue;
        }

        // By language { english: { 'number.min': <string | template> } }

        const language = code;
        target[language] = {};

        for (code in message) {
            const localized = message[code];

            if (code === 'root') {
                target[language][code] = localized;
                continue;
            }

            target[language][code] = localized.source;
        }
    }

    return target;
};


exports.errors = FileConfig;

internals.cache = function () {

    const compiled = {};

    for (const code in exports.errors) {
        if (code === 'root') {
            continue;
        }

        compiled[code] = new Template(exports.errors[code]);
    }

    return compiled;
};

exports.compiled = internals.cache();
