// Run: node --experimental-strip-types src/handroles.test.ts  (Node 22.6+)
import { strict as assert } from "node:assert";
import { assignRoles } from "./handroles.ts";

assert.deepEqual(assignRoles([]), { steer: 0, color: null });
assert.deepEqual(assignRoles(["Right"]), { steer: 0, color: null });
assert.deepEqual(assignRoles(["Right", "Left"]), { steer: 0, color: 1 });
assert.deepEqual(assignRoles(["Left", "Right"]), { steer: 1, color: 0 });
assert.deepEqual(assignRoles(["Left", "Left"]), { steer: 0, color: 1 }); // fallback
console.log("handroles ok");
