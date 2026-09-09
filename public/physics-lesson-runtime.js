/**
 * Fixed-step, local-engine mechanics experiments. Public values use m, kg and s.
 * The owner drives step() and draw(); this module never starts an animation loop.
 */
const FIXED_STEP = 1 / 120;
const MATTER_SCALE = 100;
const ENGINE_SCRIPTS = { matter: "/vendor/matter.min.js", planck: "/vendor/planck.min.js" };
const engineLoads = new Map();

export const PHYSICS_PRESET_PARAMETERS = Object.freeze({
  inclined_plane: Object.freeze({ angle: [5, 60, 25], friction: [0, 0.6, 0.15], gravity: [1, 20, 9.8], mass: [0.2, 5, 1] }),
  pendulum: Object.freeze({ length: [0.5, 3, 1.8], angle: [5, 60, 30], gravity: [1, 20, 9.8], mass: [0.2, 5, 1] }),
  collision: Object.freeze({ mass: [0.2, 5, 1], mass_b: [0.2, 5, 1], initial_speed: [0.5, 8, 3], restitution: [0, 1, 0.9] }),
});

export function normalizePhysicsParameters(preset, parameters = {}) {
  const rules = PHYSICS_PRESET_PARAMETERS[preset];
  if (!rules) throw new Error(`不支持的物理实验：${preset}`);
  return Object.fromEntries(Object.entries(rules).map(([key, [min, max, fallback]]) => {
    const candidate = parameters[key];
    const value = typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
    return [key, Math.max(min, Math.min(max, value))];
  }));
}

async function loadEngine(name) {
  const globalName = name === "matter" ? "Matter" : "planck";
  if (globalThis[globalName]) return globalThis[globalName];
  if (typeof document === "undefined") throw new Error(`物理引擎 ${name} 未加载`);
  if (!engineLoads.has(name)) {
    const loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = ENGINE_SCRIPTS[name];
      script.async = true;
      const timeout = setTimeout(() => { script.remove(); reject(new Error(`${name} 引擎加载超时，请重试`)); }, 12000);
      script.onload = () => {
        clearTimeout(timeout);
        if (globalThis[globalName]) resolve(globalThis[globalName]);
        else reject(new Error(`${name} 引擎文件未提供预期接口`));
      };
      script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error(`${name} 引擎加载失败，请检查本地依赖`)); };
      document.head.append(script);
    }).catch((error) => { engineLoads.delete(name); throw error; });
    engineLoads.set(name, loading);
  }
  return engineLoads.get(name);
}

export class PhysicsLessonRuntime {
  constructor({ canvas = null, engine = "matter", preset = "inclined_plane", parameters = {}, onUpdate, dependency } = {}) {
    if (!ENGINE_SCRIPTS[engine]) throw new Error(`不支持的物理引擎：${engine}`);
    this.canvas = canvas;
    this.engine = engine;
    this.preset = preset;
    this.parameters = normalizePhysicsParameters(preset, parameters);
    this.onUpdate = typeof onUpdate === "function" ? onUpdate : null;
    this.api = dependency || null;
    this.world = null;
    this.bodies = [];
    this.elapsed = 0;
    this.accumulator = 0;
    this.completed = false;
    this.destroyed = false;
    this.ready = false;
  }

  async init() {
    if (this.destroyed) throw new Error("物理实验已销毁");
    if (this.ready) return this;
    this.api ||= await loadEngine(this.engine);
    if (this.destroyed) throw new Error("物理实验已销毁");
    this.reset();
    return this;
  }

  reset(parameters = this.parameters) {
    if (this.destroyed) throw new Error("物理实验已销毁");
    if (!this.api) throw new Error("请先初始化物理引擎");
    this.clearWorld();
    this.parameters = normalizePhysicsParameters(this.preset, { ...this.parameters, ...parameters });
    this.elapsed = 0;
    this.accumulator = 0;
    this.completed = false;
    this.bodies = [];
    this.scene = this.createScene();
    if (this.engine === "matter") this.createMatterWorld();
    else this.createPlanckWorld();
    this.ready = true;
    this.onUpdate?.(this.getSnapshot());
    return this.getSnapshot();
  }

  createScene() {
    const p = this.parameters;
    if (this.preset === "inclined_plane") {
      const angle = p.angle * Math.PI / 180;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const normal = { x: Math.sin(angle), y: -Math.cos(angle) };
      const start = { x: 1.05, y: 4.75 - 5 * Math.sin(angle) };
      return {
        angle, direction, normal, start,
        end: { x: start.x + direction.x * 5, y: start.y + direction.y * 5 },
        ramp: { x: start.x + direction.x * 2.5 - normal.x * 0.09, y: start.y + direction.y * 2.5 - normal.y * 0.09 },
        initial: { x: start.x + direction.x * 0.55 + normal.x * 0.212, y: start.y + direction.y * 0.55 + normal.y * 0.212 },
      };
    }
    if (this.preset === "pendulum") {
      const angle = p.angle * Math.PI / 180;
      const pivot = { x: 4, y: 0.75 };
      return { pivot, initial: { x: pivot.x + p.length * Math.sin(angle), y: pivot.y + p.length * Math.cos(angle) } };
    }
    return { initial: { x: 1.8, y: 2.9 }, secondary: { x: 4.6, y: 2.9 } };
  }

  createMatterWorld() {
    const M = this.api;
    const p = this.parameters;
    const s = this.scene;
    const scale = MATTER_SCALE;
    this.world = M.Engine.create({ enableSleeping: false, positionIterations: 10, velocityIterations: 10, constraintIterations: 8 });
    this.world.gravity.x = 0;
    this.world.gravity.y = this.preset === "collision" ? 0 : 1;
    this.world.gravity.scale = (p.gravity || 0) * scale / 1e6;
    // Matter's native friction is a solver heuristic rather than an SI Coulomb
    // coefficient. The ramp applies the explicit mu*N force in stepMatter().
    const dynamicOptions = { frictionAir: 0, friction: 0, frictionStatic: 0, restitution: p.restitution || 0, slop: 0.005 };
    const addBox = (point, width, height, mass, id, angle = 0) => {
      const body = M.Bodies.rectangle(point.x * scale, point.y * scale, width * scale, height * scale, { ...dynamicOptions, angle });
      M.Body.setMass(body, mass);
      if (this.preset === "collision") M.Body.setInertia(body, Infinity);
      M.Composite.add(this.world.world, body);
      this.bodies.push({ id, body, shape: "box", width, height, mass });
      return body;
    };
    if (this.preset === "inclined_plane") {
      const ramp = M.Bodies.rectangle(s.ramp.x * scale, s.ramp.y * scale, 5 * scale, 0.18 * scale, { isStatic: true, angle: s.angle, friction: 0, frictionStatic: 0, restitution: 0 });
      const floor = M.Bodies.rectangle(4 * scale, 5.3 * scale, 40 * scale, 0.2 * scale, { isStatic: true, friction: 0, restitution: 0 });
      M.Composite.add(this.world.world, [ramp, floor]);
      addBox(s.initial, 0.4, 0.4, p.mass, "block", s.angle);
    } else if (this.preset === "pendulum") {
      const bob = M.Bodies.circle(s.initial.x * scale, s.initial.y * scale, 0.17 * scale, dynamicOptions);
      M.Body.setMass(bob, p.mass);
      M.Body.setInertia(bob, Infinity);
      const joint = M.Constraint.create({ pointA: { x: s.pivot.x * scale, y: s.pivot.y * scale }, bodyB: bob, length: p.length * scale, stiffness: 1, damping: 0 });
      M.Composite.add(this.world.world, [bob, joint]);
      this.bodies.push({ id: "bob", body: bob, shape: "circle", radius: 0.17, mass: p.mass });
    } else {
      const a = addBox(s.initial, 0.55, 0.55, p.mass, "body_a");
      addBox(s.secondary, 0.55, 0.55, p.mass_b, "body_b");
      M.Body.setVelocity(a, { x: p.initial_speed * scale / 60, y: 0 });
    }
  }

  createPlanckWorld() {
    const P = this.api;
    const p = this.parameters;
    const s = this.scene;
    this.world = new P.World(P.Vec2(0, this.preset === "collision" ? 0 : p.gravity));
    this.world.setAllowSleeping(false);
    const fixture = { friction: p.friction || 0, restitution: p.restitution || 0 };
    const addBox = (point, width, height, mass, id, angle = 0) => {
      const body = this.world.createDynamicBody({ position: P.Vec2(point.x, point.y), angle, fixedRotation: this.preset === "collision", bullet: true });
      body.createFixture(P.Box(width / 2, height / 2), { ...fixture, density: mass / (width * height) });
      this.bodies.push({ id, body, shape: "box", width, height, mass });
      return body;
    };
    if (this.preset === "inclined_plane") {
      const ramp = this.world.createBody({ position: P.Vec2(s.ramp.x, s.ramp.y), angle: s.angle });
      ramp.createFixture(P.Box(2.5, 0.09), { friction: p.friction });
      const floor = this.world.createBody({ position: P.Vec2(4, 5.3) });
      floor.createFixture(P.Box(20, 0.1), { friction: p.friction });
      addBox(s.initial, 0.4, 0.4, p.mass, "block", s.angle);
    } else if (this.preset === "pendulum") {
      const anchor = this.world.createBody({ position: P.Vec2(s.pivot.x, s.pivot.y) });
      const bob = this.world.createDynamicBody({ position: P.Vec2(s.initial.x, s.initial.y), fixedRotation: true });
      bob.createFixture(P.Circle(0.17), { density: p.mass / (Math.PI * 0.17 ** 2) });
      this.world.createJoint(P.DistanceJoint({ length: p.length, frequencyHz: 0, dampingRatio: 0, collideConnected: false }, anchor, bob, P.Vec2(s.pivot.x, s.pivot.y), P.Vec2(s.initial.x, s.initial.y)));
      this.bodies.push({ id: "bob", body: bob, shape: "circle", radius: 0.17, mass: p.mass });
    } else {
      const a = addBox(s.initial, 0.55, 0.55, p.mass, "body_a");
      addBox(s.secondary, 0.55, 0.55, p.mass_b, "body_b");
      a.setLinearVelocity(P.Vec2(p.initial_speed, 0));
    }
  }

  /** Catch-up is capped at 250 ms per call so a hidden browser tab cannot stall UI. */
  step(dt = 1 / 60) {
    if (!this.ready || this.destroyed || this.completed) return this.getSnapshot();
    if (!Number.isFinite(dt) || dt < 0) throw new Error("时间步长必须是非负有限数");
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator + 1e-12 >= FIXED_STEP) {
      if (this.engine === "matter") this.stepMatter();
      else this.world.step(FIXED_STEP, 10, 8);
      this.accumulator = Math.max(0, this.accumulator - FIXED_STEP);
      this.elapsed += FIXED_STEP;
      if (this.preset === "inclined_plane") {
        const body = this.bodies[0].body;
        const x = this.engine === "matter" ? body.position.x / MATTER_SCALE : body.getPosition().x;
        if (x >= 18) {
          this.completed = true;
          this.accumulator = 0;
          break;
        }
      }
    }
    const snapshot = this.getSnapshot();
    this.onUpdate?.(snapshot);
    return snapshot;
  }

  stepMatter() {
    if (this.preset === "inclined_plane" && this.parameters.friction > 0) {
      const { body } = this.bodies[0];
      const s = this.scene;
      const p = this.parameters;
      const point = { x: body.position.x / MATTER_SCALE, y: body.position.y / MATTER_SCALE };
      const along = (point.x - s.start.x) * s.direction.x + (point.y - s.start.y) * s.direction.y;
      const above = (point.x - s.start.x) * s.normal.x + (point.y - s.start.y) * s.normal.y;
      let tangent;
      let gravityAlong;
      let normalAcceleration;
      // Half a centimetre of contact tolerance includes the solver's slop.
      if (along >= 0 && along <= 5 && above <= 0.217 && above >= 0.15) {
        tangent = s.direction;
        gravityAlong = p.gravity * Math.sin(s.angle);
        normalAcceleration = p.gravity * Math.cos(s.angle);
      } else if (point.y >= 4.995) {
        tangent = { x: 1, y: 0 };
        gravityAlong = 0;
        normalAcceleration = p.gravity;
      }
      if (tangent) {
        const velocity = this.api.Body.getVelocity(body);
        const speedAlong = (velocity.x * tangent.x + velocity.y * tangent.y) * 60 / MATTER_SCALE;
        const maximum = p.friction * normalAcceleration;
        // Use the same coefficient for static and kinetic friction. Limit the
        // impulse at rest so friction cannot reverse velocity by itself.
        const acceleration = -Math.max(-maximum, Math.min(maximum, gravityAlong + speedAlong / FIXED_STEP));
        const force = acceleration * body.mass * MATTER_SCALE / 1e6;
        this.api.Body.applyForce(body, body.position, { x: tangent.x * force, y: tangent.y * force });
      }
    }
    this.api.Engine.update(this.world, FIXED_STEP * 1000);
  }

  getSnapshot() {
    const bodies = this.bodies.map(({ id, body, mass }) => {
      const matter = this.engine === "matter";
      const position = matter ? body.position : body.getPosition();
      const velocity = matter ? this.api.Body.getVelocity(body) : body.getLinearVelocity();
      const factor = matter ? MATTER_SCALE : 1;
      const vf = matter ? 60 / MATTER_SCALE : 1;
      const vx = velocity.x * vf;
      const vy = velocity.y * vf;
      return { id, mass, x: position.x / factor, y: position.y / factor, vx, vy, speed: Math.hypot(vx, vy), angle: matter ? body.angle : body.getAngle(), angular_velocity: matter ? this.api.Body.getAngularVelocity(body) * 60 : body.getAngularVelocity() };
    });
    const first = bodies[0];
    const displacement = first && this.scene ? Math.hypot(first.x - this.scene.initial.x, first.y - this.scene.initial.y) : 0;
    const kineticEnergy = bodies.reduce((sum, body) => sum + 0.5 * body.mass * body.speed ** 2, 0);
    const potentialEnergy = this.preset === "pendulum" && first
      ? first.mass * this.parameters.gravity * (this.scene.pivot.y + this.parameters.length - first.y)
      : this.preset === "inclined_plane" && first ? first.mass * this.parameters.gravity * (5.2 - first.y) : 0;
    return {
      engine: this.engine, preset: this.preset, ready: this.ready && !this.destroyed,
      completed: this.completed, completion_reason: this.completed ? "track_end" : null,
      elapsed: this.elapsed, parameters: { ...this.parameters }, bodies,
      speed: first?.speed || 0, displacement,
      kinetic_energy: kineticEnergy, potential_energy: potentialEnergy,
      total_energy: kineticEnergy + potentialEnergy,
      momentum_x: bodies.reduce((sum, body) => sum + body.mass * body.vx, 0),
      pendulum_angle: this.preset === "pendulum" && first ? Math.atan2(first.x - this.scene.pivot.x, first.y - this.scene.pivot.y) * 180 / Math.PI : null,
    };
  }

  draw() {
    if (!this.canvas || !this.ready || this.destroyed) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    // Keep the backing dimensions stable for captureStream / video export.
    // The owner's CSS scales the canvas to the available screen width.
    const width = Math.max(1, this.canvas.width || 900);
    const height = Math.max(1, this.canvas.height || 520);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f5f8ff";
    ctx.fillRect(0, 0, width, height);
    const snapshot = this.getSnapshot();
    let minX = 0;
    let maxX = 8;
    if (this.preset === "collision" || this.preset === "inclined_plane") {
      minX = Math.min(0, ...snapshot.bodies.map((body) => body.x - 0.9));
      maxX = Math.max(8, ...snapshot.bodies.map((body) => body.x + 0.9));
      if (this.preset === "inclined_plane") maxX = Math.min(maxX, 20);
    }
    const scale = Math.min((width - 52) / (maxX - minX), (height - 70) / 5.6);
    const offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale;
    const offsetY = 33 + (height - 70 - 5.6 * scale) / 2;
    const xy = (x, y) => ({ x: offsetX + x * scale, y: offsetY + y * scale });
    const line = (a, b, color = "#c5d2e7", lineWidth = 1, dash = []) => {
      const aa = xy(a.x, a.y); const bb = xy(b.x, b.y);
      ctx.beginPath(); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
      ctx.moveTo(aa.x, aa.y); ctx.lineTo(bb.x, bb.y); ctx.stroke(); ctx.setLineDash([]);
    };
    const label = (text, point, color = "#51617b", align = "left") => {
      const at = xy(point.x, point.y); ctx.fillStyle = color; ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = align; ctx.fillText(text, at.x, at.y);
    };
    for (let y = 1; y <= 5; y++) line({ x: minX, y }, { x: maxX, y }, "#e4ebf6", 1, [3, 5]);
    const s = this.scene;
    if (this.preset === "inclined_plane") {
      const a = xy(s.start.x, s.start.y); const b = xy(s.end.x, s.end.y); const c = xy(s.start.x, s.end.y);
      ctx.fillStyle = "#dfe9f9"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath(); ctx.fill();
      line(s.start, s.end, "#6e8dbb", Math.max(3, scale * 0.04));
      line({ x: minX + 0.5, y: 5.2 }, { x: maxX - 0.5, y: 5.2 }, "#c0ccdd", 2);
      label(`θ = ${this.parameters.angle}°`, { x: s.end.x - 0.15, y: s.end.y + 0.38 }, "#425c85", "right");
      label(`μ = ${this.parameters.friction.toFixed(2)}`, { x: s.start.x + 0.15, y: Math.min(4.8, (s.start.y + s.end.y) / 2 + 0.7) });
    } else if (this.preset === "pendulum") {
      const pivot = xy(s.pivot.x, s.pivot.y);
      line({ x: 2.8, y: s.pivot.y - 0.12 }, { x: 5.2, y: s.pivot.y - 0.12 }, "#7f94b6", 5);
      line(s.pivot, { x: s.pivot.x, y: s.pivot.y + this.parameters.length }, "#becce2", 1, [4, 4]);
      const first = snapshot.bodies[0];
      line(s.pivot, first, "#667c9d", 2.5);
      ctx.beginPath(); ctx.arc(pivot.x, pivot.y, 4, 0, Math.PI * 2); ctx.fillStyle = "#344c70"; ctx.fill();
      label(`L = ${this.parameters.length.toFixed(2)} m`, { x: 4.18, y: s.pivot.y + this.parameters.length * 0.55 });
      const radius = this.parameters.length * scale;
      ctx.beginPath(); ctx.arc(pivot.x, pivot.y, radius, Math.PI / 6, 5 * Math.PI / 6); ctx.strokeStyle = "#c9d9ef"; ctx.setLineDash([3, 5]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    } else {
      line({ x: minX + 0.1, y: 3.205 }, { x: maxX - 0.1, y: 3.205 }, "#99aecb", 2);
      const tickStep = Math.max(1, Math.ceil((maxX - minX) / 10));
      for (let x = Math.ceil(minX / tickStep) * tickStep; x < maxX; x += tickStep) {
        line({ x, y: 3.205 }, { x, y: 3.3 }, "#99aecb");
        label(`${x} m`, { x, y: 3.65 }, "#697b94", "center");
      }
      label("水平无摩擦 · 正方向 →", { x: (minX + maxX) / 2, y: 4.45 }, "#697b94", "center");
    }
    snapshot.bodies.forEach((body, index) => {
      const descriptor = this.bodies[index]; const at = xy(body.x, body.y);
      ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(body.angle);
      ctx.fillStyle = index === 0 ? "#4775e9" : "#ed994c"; ctx.strokeStyle = index === 0 ? "#315bcc" : "#cd7935"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (descriptor.shape === "circle") ctx.arc(0, 0, descriptor.radius * scale, 0, Math.PI * 2);
      else ctx.rect(-descriptor.width * scale / 2, -descriptor.height * scale / 2, descriptor.width * scale, descriptor.height * scale);
      ctx.fill(); ctx.stroke(); ctx.restore();
      label(`${this.preset === "collision" ? (index === 0 ? "A · " : "B · ") : ""}${body.mass.toFixed(1)} kg`, { x: body.x, y: body.y - 0.42 }, index === 0 ? "#315bcc" : "#b5682b", "center");
      if (this.preset === "collision") label(`v = ${body.vx.toFixed(2)} m/s`, { x: body.x, y: body.y - 0.76 }, "#405473", "center");
    });
    ctx.textAlign = "left"; ctx.font = "12px system-ui, sans-serif"; ctx.fillStyle = "#61728e";
    ctx.fillText(`t = ${snapshot.elapsed.toFixed(2)} s`, 18, 23);
    ctx.textAlign = "right"; ctx.fillText(this.engine === "matter" ? "Matter.js · 2D 物理" : "Planck.js · Box2D 风格", width - 18, 23);
    ctx.textAlign = "left";
    ctx.fillText(snapshot.completed ? "已到达实验边界 · 重置后可再次播放" : this.preset === "collision" ? `系统动量 ${snapshot.momentum_x.toFixed(2)} kg·m/s` : `速率 ${snapshot.speed.toFixed(2)} m/s    位移 ${snapshot.displacement.toFixed(2)} m`, 18, height - 14);
  }

  clearWorld() {
    if (!this.world) return;
    if (this.engine === "matter") {
      this.api.Composite.clear(this.world.world, false);
      this.api.Engine.clear(this.world);
    } else {
      for (let body = this.world.getBodyList(); body;) {
        const next = body.getNext(); this.world.destroyBody(body); body = next;
      }
    }
    this.world = null;
    this.ready = false;
  }

  destroy() {
    this.clearWorld();
    this.destroyed = true;
    this.bodies = [];
    this.canvas = null;
    this.onUpdate = null;
  }
}
