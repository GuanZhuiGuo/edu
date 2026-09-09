import test from "node:test";
import assert from "node:assert/strict";
import Matter from "matter-js";
import * as Planck from "planck";
import { PhysicsLessonRuntime, normalizePhysicsParameters } from "../public/physics-lesson-runtime.js";

const ENGINES = [["matter", Matter], ["planck", Planck]];
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}, tolerance ${tolerance}`);
const advance = (runtime, seconds) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) runtime.step(1 / 120);
  return runtime.getSnapshot();
};

test("physics parameters use preset-specific finite bounds", () => {
  assert.deepEqual(normalizePhysicsParameters("inclined_plane", { angle: 200, friction: -1, mass: NaN, gravity: 0, untrusted: 50 }), { angle: 60, friction: 0, gravity: 1, mass: 1 });
  assert.deepEqual(normalizePhysicsParameters("collision", { mass: 0, mass_b: 40, initial_speed: Infinity, restitution: 2 }), { mass: 0.2, mass_b: 5, initial_speed: 3, restitution: 1 });
  assert.throws(() => normalizePhysicsParameters("unsupported"), /不支持/);
  assert.throws(() => new PhysicsLessonRuntime({ engine: "fake" }), /不支持/);
});

for (const [engine, dependency] of ENGINES) {
  const make = (preset, parameters = {}, extra = {}) => new PhysicsLessonRuntime({ engine, dependency, preset, parameters, ...extra }).init();

  test(`${engine}: inclined plane matches g(sinθ−μcosθ), independent of mass`, async () => {
    for (const mass of [0.2, 5]) {
      const runtime = await make("inclined_plane", { mass, angle: 25, friction: 0.15, gravity: 9.8 });
      const after = advance(runtime, 0.8);
      const radians = 25 * Math.PI / 180;
      const acceleration = 9.8 * (Math.sin(radians) - 0.15 * Math.cos(radians));
      near(after.speed, acceleration * 0.8, 0.025, "speed follows Coulomb mechanics");
      near(after.bodies[0].vx / after.speed, Math.cos(radians), 0.002, "motion follows ramp tangent");
      near(after.bodies[0].mass, mass, 1e-10, "kg mass remains correct");
      runtime.destroy();
    }
    const frictionless = await make("inclined_plane", { angle: 30, friction: 0, gravity: 4 });
    near(advance(frictionless, 1).speed, 2, 0.015, "gravity is in m/s²");
    frictionless.destroy();
    const staticBlock = await make("inclined_plane", { angle: 25, friction: 0.6 });
    const stopped = advance(staticBlock, 1);
    assert.ok(stopped.speed < 0.002, "static friction holds when μ > tan θ");
    assert.ok(stopped.displacement < 0.02, "contact settling is below 2 cm");
    staticBlock.destroy();
  });

  test(`${engine}: collision satisfies momentum and restitution for unequal masses`, async () => {
    for (const restitution of [0, 0.5, 1]) {
      const runtime = await make("collision", { mass: 2, mass_b: 1, initial_speed: 3, restitution });
      const start = runtime.getSnapshot();
      const after = advance(runtime, 1.1);
      const [a, b] = after.bodies;
      near(after.momentum_x, start.momentum_x, 1e-7, "linear momentum is conserved");
      near(a.vx, (2 - restitution) / 3 * 3, 0.005, "first body's analytic velocity");
      near(b.vx, (1 + restitution) * 2 / 3 * 3, 0.005, "second body's analytic velocity");
      near(b.vx - a.vx, restitution * 3, 0.005, "relative velocity matches coefficient of restitution");
      near(a.vy, 0, 1e-7, "collision stays on horizontal rail");
      if (restitution === 1) near(after.kinetic_energy, start.kinetic_energy, 1e-6, "elastic collision conserves kinetic energy");
      else assert.ok(after.kinetic_energy < start.kinetic_energy, "inelastic collision loses kinetic energy");
      runtime.destroy();
    }
  });

  test(`${engine}: pendulum constrains length and period grows with √length`, async () => {
    const crossings = [];
    for (const length of [0.8, 2.4]) {
      const runtime = await make("pendulum", { length, angle: 10, mass: 1, gravity: 9.8 });
      let crossing;
      for (let i = 0; i < 300; i++) {
        const sample = runtime.step(1 / 120);
        const bob = sample.bodies[0];
        near(Math.hypot(bob.x - 4, bob.y - 0.75), length, 0.005, "joint preserves pendulum length");
        if (sample.pendulum_angle <= 0) { crossing = sample.elapsed; break; }
      }
      assert.ok(crossing, "pendulum crosses the vertical");
      near(crossing, Math.PI / 2 * Math.sqrt(length / 9.8), 0.022, "small-angle quarter period");
      crossings.push(crossing);
      runtime.destroy();
    }
    near(crossings[1] / crossings[0], Math.sqrt(3), 0.05, "period scales with square root of length");
    const light = await make("pendulum", { mass: 0.2 });
    const heavy = await make("pendulum", { mass: 5 });
    near(advance(light, 1).pendulum_angle, advance(heavy, 1).pendulum_angle, 1e-7, "pendulum period is independent of bob mass");
    light.destroy(); heavy.destroy();
  });

  test(`${engine}: fixed-step batching, reset, and teardown keep worlds isolated`, async () => {
    const runtime = await make("collision", { restitution: 0.6 });
    const firstWorld = runtime.world;
    const sample = advance(runtime, 1);
    const reset = runtime.reset();
    assert.equal(reset.elapsed, 0);
    assert.equal(reset.bodies[0].vx, 3);
    assert.notEqual(runtime.world, firstWorld);
    if (engine === "matter") assert.equal(Matter.Composite.allBodies(firstWorld.world).length, 0);
    else assert.equal(firstWorld.getBodyCount(), 0);
    for (let i = 0; i < 30; i++) runtime.step(1 / 30);
    const replay = runtime.getSnapshot();
    assert.deepEqual(replay, sample, "same fixed steps replay identically despite frame batching");
    runtime.reset({ initial_speed: 6 });
    assert.equal(runtime.getSnapshot().parameters.restitution, 0.6, "partial reset retains other controls");
    assert.equal(runtime.getSnapshot().bodies[0].vx, 6);
    assert.throws(() => runtime.step(NaN), /时间步长/);
    runtime.step(100);
    near(runtime.getSnapshot().elapsed, 0.25, 1e-10, "tab catch-up is bounded");
    runtime.destroy();
    runtime.destroy();
    assert.equal(runtime.getSnapshot().ready, false);
    assert.deepEqual(runtime.getSnapshot().bodies, []);
    assert.throws(() => runtime.reset(), /销毁/);
    await assert.rejects(() => runtime.init(), /销毁/);
  });

  test(`${engine}: ramp ends at a visible boundary and can be replayed`, async () => {
    const runtime = await make("inclined_plane", { angle: 60, gravity: 20, friction: 0 });
    const end = advance(runtime, 12);
    assert.equal(end.completed, true);
    assert.equal(end.completion_reason, "track_end");
    assert.ok(end.bodies[0].x >= 18 && end.bodies[0].x < 18.2, "block remains inside the bounded 20 m view");
    assert.ok(end.bodies[0].y < 5.6, "extended ground prevents falling below the view");
    assert.deepEqual(runtime.step(), end, "finished experiments do not advance off screen");
    assert.equal(runtime.reset().completed, false, "reset allows replay");
    runtime.destroy();
  });
}

test("missing selected engine rejects explicitly without fallback", async () => {
  const previousDocument = globalThis.document;
  const previousMatter = globalThis.Matter;
  let requested;
  globalThis.Matter = undefined;
  globalThis.document = {
    createElement: () => ({ remove() {} }),
    head: { append(script) { requested = script.src; queueMicrotask(() => script.onerror()); } },
  };
  try {
    await assert.rejects(() => new PhysicsLessonRuntime({ engine: "matter" }).init(), /matter 引擎加载失败/);
    assert.equal(requested, "/vendor/matter.min.js");
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousMatter === undefined) delete globalThis.Matter; else globalThis.Matter = previousMatter;
  }
});

test("canvas drawing preserves the video recording backing dimensions", async () => {
  const commands = [];
  const context = new Proxy({}, { get: (target, key) => target[key] ?? ((...args) => commands.push([key, ...args])), set: (target, key, value) => { target[key] = value; return true; } });
  const canvas = { width: 900, height: 520, getContext: () => context, getBoundingClientRect: () => ({ width: 360, height: 208 }) };
  const runtime = await new PhysicsLessonRuntime({ canvas, engine: "matter", dependency: Matter }).init();
  runtime.draw();
  assert.equal(canvas.width, 900);
  assert.equal(canvas.height, 520);
  assert.ok(commands.some(([command, text]) => command === "fillText" && text.includes("Matter.js")), "engine identity is visible");
  runtime.destroy();
});
