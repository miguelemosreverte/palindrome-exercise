/**
 * BridgeFSM — Finite State Machine engine for Bridge
 * Supports hierarchical (invoke), parallel states, workflow steps, and final states.
 * Works in browser (window.BridgeFSM) and Node (require('./fsm'))
 */
(function (root) {
  var actions = {};

  function matchEvent(pattern, event) {
    if (pattern === '*') return true;
    if (pattern === event) return true;
    if (pattern.endsWith('-*') && event.startsWith(pattern.slice(0, -1))) return true;
    return false;
  }

  function findTransition(stateDef, event) {
    if (!stateDef || !stateDef.on) return null;
    var keys = Object.keys(stateDef.on);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === event) return stateDef.on[keys[i]];
    }
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== '*' && keys[i] !== event && matchEvent(keys[i], event))
        return stateDef.on[keys[i]];
    }
    if (stateDef.on['*']) return stateDef.on['*'];
    return null;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function create(def, parentNotify) {
    var machine = {
      id: def.id || 'fsm',
      state: def.initial || Object.keys(def.states)[0],
      context: clone(def.context || {}),
      _def: def,
      _listeners: [],
      _children: {},       // active child machines keyed by invoke/parallel id
      _parallelDone: {},   // tracks completed parallel children
      history: [],

      send: function (event, data) {
        var payload = data || {};
        var stateDef = def.states[machine.state];
        var transition = findTransition(stateDef, event);

        if (!transition) {
          return { state: machine.state, context: clone(machine.context), actions: [] };
        }

        if (typeof transition === 'string') transition = { target: transition };

        if (transition.guard && !transition.guard(machine.context, payload)) {
          return { state: machine.state, context: clone(machine.context), actions: [] };
        }

        var prev = machine.state;
        var target = transition.target || machine.state;
        var actionNames = transition.actions || [];

        if (transition.assign) {
          machine.context = transition.assign(clone(machine.context), payload);
        }

        machine.state = target;
        machine.history.push({ state: prev, event: event, timestamp: Date.now() });

        // Clean up old children when leaving a state
        if (prev !== target) {
          machine._children = {};
          machine._parallelDone = {};
        }

        for (var i = 0; i < actionNames.length; i++) {
          if (actions[actionNames[i]]) {
            actions[actionNames[i]](machine.context, payload, machine);
          }
        }

        var result = { state: machine.state, context: clone(machine.context), actions: actionNames };

        // Enter new state: check for invoke, parallel, run
        if (prev !== target) enterState(machine);

        for (var i = 0; i < machine._listeners.length; i++) {
          machine._listeners[i](result, event);
        }

        return result;
      },

      /** Send event that propagates to active children first */
      sendDeep: function (event, data) {
        var childIds = Object.keys(machine._children);
        for (var i = 0; i < childIds.length; i++) {
          var child = machine._children[childIds[i]];
          var childState = child._def.states[child.state];
          var childTransition = findTransition(childState, event);
          if (childTransition) {
            return child.sendDeep ? child.sendDeep(event, data) : child.send(event, data);
          }
        }
        return machine.send(event, data);
      },

      /** Returns currently running child machines */
      getActiveChildren: function () {
        var result = {};
        var ids = Object.keys(machine._children);
        for (var i = 0; i < ids.length; i++) {
          result[ids[i]] = {
            state: machine._children[ids[i]].state,
            context: clone(machine._children[ids[i]].context)
          };
        }
        return result;
      },

      onTransition: function (fn) {
        machine._listeners.push(fn);
        return function () {
          machine._listeners = machine._listeners.filter(function (f) { return f !== fn; });
        };
      },

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

    // Enter initial state
    enterState(machine);

    return machine;
  }

  function enterState(machine) {
    var stateDef = machine._def.states[machine.state];
    if (!stateDef) return;

    // Final state: notify parent
    if (stateDef.final && machine._parentNotify) {
      machine._parentNotify(machine.context);
      return;
    }

    // Invoke child machine
    if (stateDef.invoke) {
      var inv = stateDef.invoke;
      var child = create(inv.machine, function onChildDone(childCtx) {
        machine._children = {};
        if (inv.onDone) {
          var target = inv.onDone.target || machine.state;
          if (inv.onDone.assign) {
            machine.context = inv.onDone.assign(clone(machine.context), childCtx);
          }
          var prev = machine.state;
          machine.state = target;
          machine.history.push({ state: prev, event: 'done.invoke.' + inv.id, timestamp: Date.now() });
          enterState(machine);
          var result = { state: machine.state, context: clone(machine.context), actions: [] };
          for (var i = 0; i < machine._listeners.length; i++) {
            machine._listeners[i](result, 'done.invoke.' + inv.id);
          }
        }
      });
      child._parentNotify = function (childCtx) {
        machine._children = {};
        if (inv.onDone) {
          var target = inv.onDone.target || machine.state;
          if (inv.onDone.assign) {
            machine.context = inv.onDone.assign(clone(machine.context), childCtx);
          }
          var prev = machine.state;
          machine.state = target;
          machine.history.push({ state: prev, event: 'done.invoke.' + inv.id, timestamp: Date.now() });
          enterState(machine);
          var result = { state: machine.state, context: clone(machine.context), actions: [] };
          for (var i = 0; i < machine._listeners.length; i++) {
            machine._listeners[i](result, 'done.invoke.' + inv.id);
          }
        }
      };
      machine._children[inv.id] = child;
    }

    // Parallel child machines
    if (stateDef.parallel) {
      machine._parallelDone = {};
      var parallelResults = {};
      for (var p = 0; p < stateDef.parallel.length; p++) {
        (function (spec) {
          var child = create(spec.machine);
          child._parentNotify = function (childCtx) {
            parallelResults[spec.id] = childCtx;
            machine._parallelDone[spec.id] = true;
            delete machine._children[spec.id];
            // Check if all done
            if (Object.keys(machine._parallelDone).length === stateDef.parallel.length && stateDef.onAllDone) {
              var target = stateDef.onAllDone.target || machine.state;
              if (stateDef.onAllDone.assign) {
                machine.context = stateDef.onAllDone.assign(clone(machine.context), parallelResults);
              }
              var prev = machine.state;
              machine.state = target;
              machine.history.push({ state: prev, event: 'done.parallel', timestamp: Date.now() });
              enterState(machine);
              var result = { state: machine.state, context: clone(machine.context), actions: [] };
              for (var i = 0; i < machine._listeners.length; i++) {
                machine._listeners[i](result, 'done.parallel');
              }
            }
          };
          machine._children[spec.id] = child;
        })(stateDef.parallel[p]);
      }
    }

    // Workflow run metadata (exposed for host to read, no auto-execution)
    if (stateDef.run) {
      machine._currentRun = stateDef.run;
    } else {
      machine._currentRun = null;
    }
  }

  var defs = {};

  var BridgeFSM = {
    create: function (def) {
      var m = create(def);
      defs[def.id || 'fsm'] = def;
      return m;
    },

    registerAction: function (name, fn) {
      actions[name] = fn;
    },

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

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BridgeFSM;
  } else if (typeof define === 'function' && define.amd) {
    define(function () { return BridgeFSM; });
  } else if (typeof root !== 'undefined') {
    root.BridgeFSM = BridgeFSM;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : this);
