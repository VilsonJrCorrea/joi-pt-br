'use strict';

const Hoek = require('@hapi/hoek');

const Cache = require('../cache');
const Cast = require('../cast');
const Common = require('../common');
const Errors = require('../errors');
const Manifest = require('../manifest');
const Messages = require('../messages');
const Modify = require('../modify');
const Ref = require('../ref');
const Validator = require('../validator');
const Values = require('../values');

let Alternatives = null;                            // Delay-loaded to prevent circular dependencies


const internals = {
    keysToRestore: [                                // Properties to copy over when rebasing a concat source
        '_flags',
        '_ids',
        '_immutables',
        '_inners',
        '_invalids',
        '_preferences',
        '_refs',
        '_ruleset',
        '_tests',
        '_uniqueRules',
        '_valids'
    ]
};


module.exports = internals.Any = class {

    constructor(type) {

        this._type = type || 'any';
        this._ids = new Modify.Ids(this);
        this._preferences = null;
        this._refs = new Ref.Manager();
        this._cache = null;

        this._valids = null;
        this._invalids = null;

        this._tests = [];
        this._uniqueRules = new Map();
        this._ruleset = null;                       // null: use last, false: error, number: start position

        this._flags = {
            /*
             allowOnly: false,
             allowUnknown: undefined,
             cast: undefined,
             default: undefined,
             description: undefined,
             empty: undefined,
             encoding: undefined,
             failover: undefined,
             format: undefined
             func: false,
             insensitive: false,
             label: undefined,
             once: true,
             presence: 'optional',                  // optional, required, forbidden, ignore
             single: undefined,
             sparse: false,
             strip: undefined,
             timestamp: undefined,
             truncate: undefined,
             unit: undefined
             unsafe: false
             */
        };

        this._immutables = {};                     // Hash of immutable values
        this._inners = {                           // Hash of arrays of immutable objects (extended by other types)
            alterations: null,
            externals: null,

            examples: null,
            notes: [],
            meta: [],
            tags: []
        };
    }

    // About

    get type() {

        return this._type;
    }

    describe() {

        return Manifest.describe(this);
    }

    // Rules

    allow(...values) {

        Common.verifyFlat(values, 'allow');

        const obj = this.clone();

        if (!obj._valids) {
            obj._valids = new Values();
        }

        for (const value of values) {
            Hoek.assert(value !== undefined, 'Cannot call allow/valid/invalid with undefined');

            if (obj._invalids) {
                obj._invalids.remove(value);
                if (!obj._invalids.length) {
                    obj._invalids = null;
                }
            }

            obj._valids.add(value, obj._refs);
        }

        return obj;
    }

    alter(targets) {

        Hoek.assert(targets && typeof targets === 'object' && !Array.isArray(targets), 'Invalid targets argument');
        Hoek.assert(!this._inRuleset(), 'Cannot set alterations inside a ruleset');

        const obj = this.clone();
        obj._inners.alterations = obj._inners.alterations || [];
        for (const target in targets) {
            const adjuster = targets[target];
            Hoek.assert(typeof adjuster === 'function', 'Alteration adjuster for', target, 'must be a function');
            obj._inners.alterations.push({ target, adjuster });
        }

        obj._ruleset = false;
        return obj;
    }

    cast(to) {

        Hoek.assert(to === false || this._casts[to], 'Type', this._type, 'does not support casting to', to);
        return this._flag('cast', to === false ? undefined : to);
    }

    default(value, description) {

        return this._default('default', value, description);
    }

    description(desc) {

        Hoek.assert(desc && typeof desc === 'string', 'Description must be a non-empty string');

        return this._flag('description', desc);
    }

    empty(schema) {

        return this._flag('empty', schema !== undefined ? Cast.schema(this._root, schema) : undefined);
    }

    error(err) {

        Hoek.assert(err, 'Missing error');
        Hoek.assert(err instanceof Error || typeof err === 'function', 'Must provide a valid Error object or a function');

        return this._flag('error', err);
    }

    example(...examples) {

        Hoek.assert(examples.length, 'Missing examples');

        return this._inner('examples', examples, { append: false });
    }

    external(method) {

        Hoek.assert(!this._inRuleset(), 'Cannot set external rule inside a ruleset');

        const obj = this.clone();
        obj._inners.externals = obj._inners.externals || [];
        obj._inners.externals.push({ method });
        obj._ruleset = false;
        return obj;
    }

    failover(value, description) {

        return this._default('failover', value, description);
    }

    forbidden() {

        return this._flag('presence', 'forbidden');
    }

    id(id) {

        Hoek.assert(id && typeof id === 'string', 'id must be a non-empty string');
        Hoek.assert(/^[^\.]+$/.test(id), 'id cannot contain period character');
        Hoek.assert(!this._flags.id, 'Cannot override schema id');

        return this._flag('id', id);
    }

    invalid(...values) {

        Common.verifyFlat(values, 'invalid');

        const obj = this.clone();

        if (!obj._invalids) {
            obj._invalids = new Values();
        }

        for (const value of values) {
            Hoek.assert(value !== undefined, 'Cannot call allow/valid/invalid with undefined');

            if (obj._valids) {
                obj._valids.remove(value);
                if (!obj._valids.length) {
                    Hoek.assert(!obj._flags.allowOnly, 'Setting invalid value', value, 'leaves schema rejecting all values due to previous valid rule');
                    obj._valids = null;
                }
            }

            obj._invalids.add(value, obj._refs);
        }

        return obj;
    }

    keep() {

        return this.rule({ keep: true });
    }

    label(name) {

        Hoek.assert(name && typeof name === 'string', 'Label name must be a non-empty string');

        return this._flag('label', name);
    }

    meta(meta) {

        Hoek.assert(meta !== undefined, 'Meta cannot be undefined');

        return this._inner('meta', meta, { append: true });
    }

    notes(notes) {

        Hoek.assert(notes && (typeof notes === 'string' || Array.isArray(notes)), 'Notes must be a non-empty string or array');

        return this._inner('notes', notes, { append: true });
    }

    optional() {

        return this._flag('presence', 'optional');
    }

    prefs(prefs) {

        Hoek.assert(prefs.context === undefined, 'Cannot override context');
        Hoek.assert(prefs.externals === undefined, 'Cannot override externals');
        Hoek.assert(prefs.warnings === undefined, 'Cannot override warnings');

        Common.checkPreferences(prefs);

        const obj = this.clone();
        obj._preferences = Common.preferences(obj._preferences, prefs);
        return obj;
    }

    raw() {

        return this.cast('raw');
    }

    required() {

        return this._flag('presence', 'required');
    }

    strict(enabled) {

        const obj = this.clone();

        const convert = enabled === undefined ? false : !enabled;
        obj._preferences = Common.preferences(obj._preferences, { convert });
        return obj;
    }

    strip() {

        return this._flag('strip', true);
    }

    tags(tags) {

        Hoek.assert(tags && (typeof tags === 'string' || Array.isArray(tags)), 'Tags must be a non-empty string or array');

        return this._inner('tags', tags, { append: true });
    }

    unit(name) {

        Hoek.assert(name && typeof name === 'string', 'Unit name must be a non-empty string');

        return this._flag('unit', name);
    }

    valid(...values) {

        return this.allow(...values)._flag('allowOnly', true, { clone: false });
    }

    when(condition, options) {

        Alternatives = Alternatives || require('./alternatives');

        if (Array.isArray(options)) {
            options = { switch: options };
        }

        Common.assertOptions(options, ['is', 'then', 'otherwise', 'switch']);

        const process = (settings) => {

            const item = {
                is: settings.is,
                then: settings.then && this.concat(Cast.schema(this._root, settings.then))
            };

            if (settings.otherwise) {
                item.otherwise = this.concat(Cast.schema(this._root, settings.otherwise));
            }

            return item;
        };

        const alternativeOptions = process(options);

        if (options.switch) {
            Hoek.assert(Array.isArray(options.switch), '"switch" must be an array');
            alternativeOptions.switch = options.switch.map(process);
        }

        const obj = Alternatives.when(condition, alternativeOptions);
        obj._flag('presence', 'ignore', { clone: false });
        obj._baseType = this;
        return obj;
    }

    // Helpers

    cache(cache) {

        Hoek.assert(!this._inRuleset(), 'Cannot set caching inside a ruleset');
        Hoek.assert(!this._cache, 'Cannot override schema cache');

        const obj = this.clone();
        obj._cache = cache || Cache.provider.provision();
        obj._ruleset = false;
        return obj;
    }

    clone() {

        const obj = Object.create(Object.getPrototypeOf(this));

        obj._root = this._root;
        obj._type = this._type;
        obj._ids = this._ids.clone();
        obj._preferences = this._preferences;
        obj._baseType = this._baseType;
        obj._valids = this._valids && this._valids.clone();
        obj._invalids = this._invalids && this._invalids.clone();
        obj._tests = this._tests.slice();
        obj._uniqueRules = Hoek.clone(this._uniqueRules, { shallow: true });
        obj._ruleset = this._ruleset;
        obj._refs = this._refs.clone();
        obj._flags = Hoek.clone(this._flags);
        obj._cache = null;
        obj._immutables = Object.assign({}, this._immutables);

        obj._inners = {};
        for (const key in this._inners) {
            obj._inners[key] = this._inners[key] ? this._inners[key].slice() : null;
        }

        return obj;
    }

    concat(source) {

        Hoek.assert(source instanceof internals.Any, 'Invalid schema object');
        Hoek.assert(this._type === 'any' || source._type === 'any' || source._type === this._type, 'Cannot merge type', this._type, 'with another type:', source._type);

        let obj = this.clone();

        if (this._type === 'any' &&
            source._type !== 'any') {

            // Reset values as if we were "this"

            const tmpObj = source.clone();
            for (const key of internals.keysToRestore) {
                tmpObj[key] = obj[key];
            }

            obj = tmpObj;
        }

        obj._ids.concat(source._ids);
        obj._preferences = obj._preferences ? Common.preferences(obj._preferences, source._preferences) : source._preferences;
        obj._valids = Values.merge(obj._valids, source._valids, source._invalids);
        obj._invalids = Values.merge(obj._invalids, source._invalids, source._valids);
        obj._refs.register(source, Ref.toSibling);
        Object.assign(obj._immutables, source._immutables);

        // Remove unique rules present in source

        for (const name of source._uniqueRules.keys()) {
            if (obj._uniqueRules.has(name)) {
                obj._tests = obj._tests.filter((target) => target.name !== name);
                obj._uniqueRules.delete(name);
            }
        }

        // Adjust ruleset

        if (source._ruleset !== null) {
            Hoek.assert(!obj._inRuleset(), 'Cannot concatenate onto a schema with open ruleset');
            obj._ruleset = source._ruleset === false ? false : source._ruleset + obj._tests.length;
        }

        // Combine tests

        for (const test of source._tests) {
            if (test.rule &&
                !test.rule.multi) {

                obj._uniqueRules.set(test.name, test.rule._options);
            }

            obj._tests.push(test);
        }

        if (obj._flags.empty &&
            source._flags.empty) {

            obj._flags.empty = obj._flags.empty.concat(source._flags.empty);
            const flags = Object.assign({}, source._flags);
            delete flags.empty;
            Hoek.merge(obj._flags, flags);
        }
        else if (source._flags.empty) {
            obj._flags.empty = source._flags.empty;
            const flags = Object.assign({}, source._flags);
            delete flags.empty;
            Hoek.merge(obj._flags, flags);
        }
        else {
            Hoek.merge(obj._flags, source._flags);
        }

        for (const key in source._inners) {
            const inners = source._inners[key];
            if (!inners) {
                continue;
            }

            const targets = obj._inners[key];
            if (!targets) {
                obj._inners[key] = inners.slice();
                continue;
            }

            if (obj._type !== 'object' ||
                key !== 'children') {

                obj._inners[key] = obj._inners[key].concat(inners);
                continue;
            }

            // Special handling for object children

            const keys = {};
            for (let i = 0; i < targets.length; ++i) {
                keys[targets[i].key] = i;
            }

            for (const inner of inners) {
                const sourceKey = inner.key;
                if (keys[sourceKey] >= 0) {
                    targets[keys[sourceKey]] = {
                        key: sourceKey,
                        schema: targets[keys[sourceKey]].schema.concat(inner.schema)
                    };
                }
                else {
                    targets.push(inner);
                }
            }
        }

        return obj;
    }

    createError(code, value, local, state, prefs) {

        return new Errors.Report(code, value, local, state, prefs);
    }

    extract(path) {

        path = Array.isArray(path) ? path : path.split('.');
        return this._ids.reach(path);
    }

    fork(paths, adjuster) {

        Hoek.assert(!this._inRuleset(), 'Cannot fork inside a ruleset');

        let obj = this;                                             // eslint-disable-line consistent-this
        for (let path of [].concat(paths)) {
            path = Array.isArray(path) ? path : path.split('.');
            obj = obj._ids.fork(path, adjuster, obj);
        }

        obj._ruleset = false;
        return obj;
    }

    mapLabels(path) {

        path = Array.isArray(path) ? path : path.split('.');
        return this._ids.labels(path);
    }

    message(message) {

        return this.rule({ message });
    }

    rule(options) {

        Common.assertOptions(options, ['keep', 'message', 'warn']);

        Hoek.assert(this._ruleset !== false, 'Cannot apply rules to empty ruleset');
        const start = this._ruleset === null ? this._tests.length - 1 : this._ruleset;
        Hoek.assert(start >= 0 && start < this._tests.length, 'Cannot apply rules to empty ruleset');

        options = Object.assign({}, options);                   // Shallow cloned

        if (options.message) {
            options.message = Messages.compile(options.message);
        }

        const obj = this.clone();

        for (let i = start; i < obj._tests.length; ++i) {
            obj._tests[i] = Object.assign({}, obj._tests[i], options);
        }

        obj._ruleset = false;
        return obj;
    }

    get ruleset() {

        Hoek.assert(!this._inRuleset(), 'Cannot start a new ruleset without closing the previous one');

        const obj = this.clone();
        obj._ruleset = obj._tests.length;
        return obj;
    }

    get $() {

        return this.ruleset;
    }

    tailor(targets) {

        Hoek.assert(!this._inRuleset(), 'Cannot tailor inside a ruleset');

        if (!this._inners.alterations) {
            return this;
        }

        targets = [].concat(targets);

        let obj = this;                                                     // eslint-disable-line consistent-this
        for (const { target, adjuster } of this._inners.alterations) {
            if (targets.includes(target)) {
                obj = adjuster(obj);
                Hoek.assert(Common.isSchema(obj), 'Alteration adjuster for', target, 'failed to return a schema object');
            }
        }

        obj._ruleset = false;
        return obj;
    }

    validate(value, options) {

        return Validator.entry(value, this, options);
    }

    warn() {

        return this.rule({ warn: true });
    }

    warning(code, local) {

        Hoek.assert(code && typeof code === 'string', 'Invalid warning code');

        return this._rule('warning', { args: { code, local }, multi: true, warn: true });
    }

    // Internals

    _default(flag, value, description) {

        if (typeof value === 'function') {
            if (!value.description &&
                description) {

                value.description = description;
            }

            if (!this._flags.func) {
                Hoek.assert(value.description && typeof value.description === 'string', `description must be provided when ${flag} value is a function`);
            }
        }

        if (value === undefined) {
            value = Common.symbols.deepDefault;
        }

        const obj = this._flag(flag, value);
        obj._refs.register(value);
        return obj;
    }

    _flag(flag, value, options = {}) {

        Hoek.assert(!this._inRuleset(), 'Cannot set flag inside a ruleset');

        let obj = this;                                         // eslint-disable-line consistent-this

        const apply = (f, v) => {

            if (Hoek.deepEqual(v, this._flags[f])) {
                return;
            }

            if (obj === this &&                                 // Clone once
                options.clone !== false) {                      // Defaults to true

                obj = this.clone();
            }

            if (v !== undefined) {
                obj._flags[f] = v;
            }
            else {
                delete obj._flags[f];
            }
        };

        if (Array.isArray(flag)) {
            for (const set of flag) {
                apply(set.flag, set.value);
            }
        }
        else {
            apply(flag, value);
        }

        obj._ruleset = false;
        return obj;
    }

    _getRules(name) {

        const rules = [];
        for (const test of this._tests) {
            if (test.name === name) {
                rules.push(test.rule._options);
            }
        }

        return rules;
    }

    _init() {

        return this;
    }

    _inner(type, value, options) {

        Hoek.assert(!this._inRuleset(), `Cannot set ${type} inside a ruleset`);

        const obj = this.clone();
        obj._inners[type] = options.append ? obj._inners[type].concat(value) : value;
        obj._ruleset = false;
        return obj;
    }

    _inRuleset() {

        return this._ruleset !== null && this._ruleset !== false;
    }

    _match(value, state, prefs) {

        prefs = Object.assign({}, prefs);       // Shallow cloned
        prefs.abortEarly = true;
        prefs._externals = false;

        return !Validator.validate(value, this, state, prefs).errors;
    }

    _register(schema, { family, key } = {}) {

        this._refs.register(schema, family);
        this._ids.register(schema, key);
    }

    _resetRegistrations() {

        this._refs.reset();
        this._ids.reset();
    }

    _rule(name, options = {}) {

        const rule = {
            rule: name,
            alias: name,
            resolve: [],
            ...options,         // args, refs, multi, convert, ...rule-specific
            _options: options   // The original options
        };

        Hoek.assert(this._rules[rule.rule], 'Unknown rule', name);
        Hoek.assert(!options.args || Object.keys(options.args).length === 1 || Object.keys(options.args).length === this._rules[rule.rule].args.length, 'Invalid rule definition for', this._type, name);

        if (!options.multi &&
            this._uniqueRules.has(name) &&
            Hoek.deepEqual(options, this._uniqueRules.get(name))) {

            return this;
        }

        const obj = this.clone();

        // Args

        const args = options.args;
        if (args) {
            for (const key in args) {
                let arg = args[key];
                if (arg === undefined) {
                    delete args[key];
                    continue;
                }

                if (options.refs) {
                    const resolver = options.refs[key];
                    if (resolver) {
                        if (Common.isResolvable(arg)) {
                            rule.resolve.push(key);
                            obj._refs.register(arg);
                        }
                        else {
                            if (resolver.normalize) {
                                arg = resolver.normalize(arg);
                                options.args[key] = arg;
                            }

                            Hoek.assert(resolver.assert(arg), resolver.message);
                        }
                    }
                }

                args[key] = arg;
            }
        }

        if (!options.multi) {
            obj._ruleRemove(name, { clone: false });
            obj._uniqueRules.set(name, rule._options);
        }

        if (obj._ruleset === false) {
            obj._ruleset = null;
        }

        const test = { rule, name };

        if (args &&
            Object.keys(args).length) {

            test.args = args;
        }

        if (rule.warn) {
            test.warn = true;
        }

        obj._tests.push(test);

        return obj;
    }

    _ruleRemove(name, options = {}) {

        if (!this._uniqueRules.has(name)) {
            return this;
        }

        const obj = options.clone !== false ? this.clone() : this;

        obj._uniqueRules.delete(name);

        const filtered = [];
        for (let i = 0; i < obj._tests.length; ++i) {
            const test = obj._tests[i];
            if (test.name === name &&
                !test.keep) {

                if (obj._inRuleset() &&
                    i < obj._ruleset) {

                    --obj._ruleset;
                }

                continue;
            }

            filtered.push(test);
        }

        obj._tests = filtered;
        return obj;
    }

    _state(path, ancestors, state, options = {}) {

        return {
            path,
            ancestors,
            mainstay: state.mainstay,
            flags: options.flags !== false ? this._flags : {}
        };
    }

    _stateEntry(state, reference) {

        const ancestors = reference !== undefined ? [reference] : [];
        return this._state([], ancestors, state);
    }

    _validate(value, state, prefs) {

        return Validator.validate(value, this, state, prefs);
    }

    _test(name, args, func, options) {

        const obj = this.clone();

        if (obj._ruleset === false) {
            obj._ruleset = null;
        }

        obj._tests.push({ func, name, args, options });

        return obj;
    }
};


internals.Any.prototype.isImmutable = true;                     // Prevents Hoek from deep cloning schema objects


internals.Any.prototype[Common.symbols.any] = {
    version: Common.version,
    compile: Cast.compile,
    root: '_root'
};


// Aliases

Common.alias(internals.Any, [

    ['invalid', 'disallow'],
    ['valid', 'equal'],
    ['required', 'exist'],
    ['invalid', 'not'],
    ['valid', 'only'],
    ['prefs', 'options'],
    ['prefs', 'preferences']
]);


// Casts

Common.extend(internals.Any, 'casts', {

    raw: function (value, { original }) {

        return original;
    }
});


// Rules

Common.extend(internals.Any, 'rules', {

    warning: {
        method: function (value, helpers, { code, local }) {

            return helpers.error(code, local);
        },
        args: ['code', 'local']
    }
});
