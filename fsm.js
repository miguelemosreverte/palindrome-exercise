/**
 * BridgeFSM — Finite State Machine engine for Bridge
 * Works in browser (window.BridgeFSM) and Node (require('./fsm'))
 */
(function (root) {
  // Global action registry
  var actions = {};

  // Match event against pattern (supports trailing wildcard: "user-says-*")
  function matchEvent(pattern, event) {
    if (pattern === '*') return true;
    if (pattern === event) return true;
    if (pattern.endsWith('-*') && event.startsWith(pattern.slice(0, -1))) return true;
    return false;
  }

  // Find matching transition for an event in a state definition
  function findTransition(stateDef, event) {
    if (!stateDef || !stateDef.on) return null;
    var keys = Object.keys(stateDef.on);
    // Exact match first, then patterns, wildcard last
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === event) return stateDef.on[keys[i]];
    }
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== '*' && keys[i] !== event && matchEvent(keys[i], event)) {
        return stateDef.on[keys[i]];
      }
    }
    if (stateDef.on['*']) return stateDef.on['*'];
    return null;
  }

  // Deep clone plain objects
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Create a new FSM instance from a definition
   */
  function create(def) {
    var machine = {
      id: def.id || 'fsm',
      state: def.initial || Object.keys(def.states)[0],
      context: clone(def.context || {}),
      _def: def,
      _listeners: [],
      history: [],

      /**
       * Send an event to the machine. Returns { state, context, actions }.
       */
      send: function (event, data) {
        var payload = data || {};
        var stateDef = def.states[machine.state];
        var transition = findTransition(stateDef, event);

        if (!transition) {
          return { state: machine.state, context: clone(machine.context), actions: [] };
        }

        // Normalize: allow transition to be a string (just target)
        if (typeof transition === 'string') transition = { target: transition };

        // Check guard
        if (transition.guard && !transition.guard(machine.context, payload)) {
          return { state: machine.state, context: clone(machine.context), actions: [] };
        }

        var prev = machine.state;
        var target = transition.target || machine.state;
        var actionNames = transition.actions || [];

        // Update context via assign
        if (transition.assign) {
          machine.context = transition.assign(clone(machine.context), payload);
        }

        machine.state = target;

        // Record history
        machine.history.push({ state: prev, event: event, timestamp: Date.now() });

        // Execute registered actions
        for (var i = 0; i < actionNames.length; i++) {
          if (actions[actionNames[i]]) {
            actions[actionNames[i]](machine.context, payload, machine);
          }
        }

        // Notify listeners
        var result = { state: machine.state, context: clone(machine.context), actions: actionNames };
        for (var i = 0; i < machine._listeners.length; i++) {
          machine._listeners[i](result, event);
        }

        return result;
      },

      /** Subscribe to state changes */
      onTransition: function (fn) {
        machine._listeners.push(fn);
        return function () {
          machine._listeners = machine._listeners.filter(function (f) { return f !== fn; });
        };
      },

      /** Serialize to JSON-safe object */
      toJSON: function () {
        return {
          id: machine.id,
          state: machine.state,
          context: clone(machine.context),
          history: machine.history.slice(),
          _defId: machine.id
        };
      }
    };

    return machine;
  }

  // Registry of machine definitions for fromJSON restoration
  var defs = {};

  var BridgeFSM = {
    /**
     * Create a machine from a definition. Also registers it for fromJSON.
     */
    create: function (def) {
      var m = create(def);
      defs[def.id || 'fsm'] = def;
      return m;
    },

    /**
     * Register a named action handler
     */
    registerAction: function (name, fn) {
      actions[name] = fn;
    },

    /**
     * Restore a machine from serialized JSON.
     * Requires the original definition to have been registered via create().
     * Alternatively pass the definition as second argument.
     */
    fromJSON: function (json, def) {
      var data = typeof json === 'string' ? JSON.parse(json) : json;
      var definition = def || defs[data._defId || data.id];
      if (!definition) throw new Error('Unknown machine "' + (data._defId || data.id) + '". Pass definition as second argument.');
      var m = create(definition);
      m.state = data.state;
      m.context = clone(data.context || {});
      m.history = data.history || [];
      return m;
    }
  };

  // Universal export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BridgeFSM;
  } else if (typeof root !== 'undefined') {
    root.BridgeFSM = BridgeFSM;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
