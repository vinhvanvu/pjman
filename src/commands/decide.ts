// Deciding in place (decision decide-in-place/decide-route-and-reopen): a proposed decision accepted by the person,
// and its reverse. Both are entries on the decision's thread (decision record-foundation/one-decision-verb), so the
// commit and the event are the ones a decision written in a session makes; the status event is what wakes the sessions
// bound to its change.
export { decide, reopen } from './decision.js';
