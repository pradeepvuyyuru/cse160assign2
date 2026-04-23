"use strict";

const VSHADER_SOURCE = `
attribute vec4 a_Position;
uniform mat4 u_ModelMatrix;
uniform mat4 u_GlobalRotation;
void main() {
  gl_Position = u_GlobalRotation * u_ModelMatrix * a_Position;
}
`;

const FSHADER_SOURCE = `
precision mediump float;
uniform vec4 u_FragColor;
void main() {
  gl_FragColor = u_FragColor;
}
`;

class Matrix4 {
  constructor(src) {
    if (src && src.elements) {
      this.elements = new Float32Array(src.elements);
    } else {
      this.elements = new Float32Array(16);
      this.setIdentity();
    }
  }

  clone() {
    return new Matrix4(this);
  }

  setIdentity() {
    const e = this.elements;
    e[0] = 1; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = 1; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
    e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
    return this;
  }

  multiply(other) {
    const a = this.elements;
    const b = other.elements;
    const e = new Float32Array(16);

    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        e[i + j * 4] =
          a[i + 0] * b[0 + j * 4] +
          a[i + 4] * b[1 + j * 4] +
          a[i + 8] * b[2 + j * 4] +
          a[i + 12] * b[3 + j * 4];
      }
    }

    this.elements = e;
    return this;
  }

  translate(x, y, z) {
    const t = new Matrix4();
    t.elements[12] = x;
    t.elements[13] = y;
    t.elements[14] = z;
    return this.multiply(t);
  }

  scale(x, y, z) {
    const s = new Matrix4();
    s.elements[0] = x;
    s.elements[5] = y;
    s.elements[10] = z;
    return this.multiply(s);
  }

  rotate(angle, x, y, z) {
    let len = Math.sqrt(x * x + y * y + z * z);
    if (len === 0) {
      return this;
    }

    x /= len;
    y /= len;
    z /= len;
    len = angle * Math.PI / 180;
    const s = Math.sin(len);
    const c = Math.cos(len);
    const nc = 1 - c;

    const r = new Matrix4();
    const e = r.elements;
    e[0] = x * x * nc + c;
    e[1] = y * x * nc + z * s;
    e[2] = z * x * nc - y * s;
    e[4] = x * y * nc - z * s;
    e[5] = y * y * nc + c;
    e[6] = z * y * nc + x * s;
    e[8] = x * z * nc + y * s;
    e[9] = y * z * nc - x * s;
    e[10] = z * z * nc + c;
    return this.multiply(r);
  }
}

let canvas;
let gl;
let a_Position;
let u_ModelMatrix;
let u_GlobalRotation;
let u_FragColor;

const g_state = {
  globalY: 28,
  globalX: -12,
  head: -6,
  tail: 22,
  flUpper: 12,
  flLower: -20,
  flHoof: 8,
  frUpper: -12,
  frLower: -16,
  frHoof: 8,
  blUpper: -10,
  blLower: -8,
  blHoof: 10,
  brUpper: 12,
  brLower: -8,
  brHoof: 10
};

const g_defaults = { ...g_state };
const g_live = {};

let g_animationOn = false;
let g_seconds = 0;
let g_lastFrameTime = performance.now();
let g_smoothedFps = 0;
let g_pokeUntil = 0;
let g_dragging = false;
let g_lastMouseX = 0;
let g_lastMouseY = 0;

const g_buffers = {};

const CONTROL_CONFIG = [
  ["globalY", "Global Y Rotate", -180, 180],
  ["globalX", "Global X Rotate", -89, 89],
  ["head", "Head Angle", -40, 40],
  ["tail", "Tail Angle", -50, 50],
  ["flUpper", "Front Left Upper", -80, 80],
  ["flLower", "Front Left Lower", -80, 40],
  ["flHoof", "Front Left Hoof", -40, 40],
  ["frUpper", "Front Right Upper", -80, 80],
  ["frLower", "Front Right Lower", -80, 40],
  ["frHoof", "Front Right Hoof", -40, 40],
  ["blUpper", "Back Left Upper", -80, 80],
  ["blLower", "Back Left Lower", -80, 40],
  ["blHoof", "Back Left Hoof", -40, 40],
  ["brUpper", "Back Right Upper", -80, 80],
  ["brLower", "Back Right Lower", -80, 40],
  ["brHoof", "Back Right Hoof", -40, 40]
];

function main() {
  canvas = document.getElementById("webgl");
  gl = canvas.getContext("webgl");
  if (!gl) {
    alert("WebGL is not supported in this browser.");
    return;
  }

  if (!initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE)) {
    alert("Shader initialization failed.");
    return;
  }

  a_Position = gl.getAttribLocation(gl.program, "a_Position");
  u_ModelMatrix = gl.getUniformLocation(gl.program, "u_ModelMatrix");
  u_GlobalRotation = gl.getUniformLocation(gl.program, "u_GlobalRotation");
  u_FragColor = gl.getUniformLocation(gl.program, "u_FragColor");

  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.82, 0.89, 0.96, 1.0);

  initBuffers();
  initUI();
  initMouseControls();

  tick();
}

function initUI() {
  const controls = document.getElementById("controls");

  CONTROL_CONFIG.forEach(([key, label, min, max]) => {
    const wrapper = document.createElement("div");
    wrapper.className = "control";

    const header = document.createElement("div");
    header.className = "control-header";

    const name = document.createElement("span");
    name.textContent = label;

    const value = document.createElement("span");
    value.id = `${key}Value`;
    value.textContent = `${g_state[key]}`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = "1";
    slider.value = String(g_state[key]);
    slider.id = `${key}Slider`;
    slider.addEventListener("input", (event) => {
      g_state[key] = Number(event.target.value);
      value.textContent = `${g_state[key]}`;
      renderScene();
    });

    header.appendChild(name);
    header.appendChild(value);
    wrapper.appendChild(header);
    wrapper.appendChild(slider);
    controls.appendChild(wrapper);
  });

  document.getElementById("animOnBtn").addEventListener("click", () => {
    g_animationOn = true;
    renderScene();
  });

  document.getElementById("animOffBtn").addEventListener("click", () => {
    g_animationOn = false;
    renderScene();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    Object.assign(g_state, g_defaults);
    CONTROL_CONFIG.forEach(([key]) => {
      document.getElementById(`${key}Slider`).value = String(g_state[key]);
      document.getElementById(`${key}Value`).textContent = `${g_state[key]}`;
    });
    g_animationOn = false;
    renderScene();
  });
}

function initMouseControls() {
  canvas.addEventListener("mousedown", (event) => {
    if (event.shiftKey) {
      g_pokeUntil = g_seconds + 1.2;
      return;
    }
    g_dragging = true;
    g_lastMouseX = event.clientX;
    g_lastMouseY = event.clientY;
  });

  window.addEventListener("mouseup", () => {
    g_dragging = false;
  });

  window.addEventListener("mousemove", (event) => {
    if (!g_dragging) {
      return;
    }
    const dx = event.clientX - g_lastMouseX;
    const dy = event.clientY - g_lastMouseY;
    g_lastMouseX = event.clientX;
    g_lastMouseY = event.clientY;

    g_state.globalY += dx * 0.6;
    g_state.globalX += dy * 0.4;
    g_state.globalX = Math.max(-89, Math.min(89, g_state.globalX));

    syncControl("globalY");
    syncControl("globalX");
    renderScene();
  });
}

function syncControl(key) {
  const slider = document.getElementById(`${key}Slider`);
  const value = document.getElementById(`${key}Value`);
  if (slider) {
    slider.value = String(Math.round(g_state[key]));
  }
  if (value) {
    value.textContent = `${Math.round(g_state[key])}`;
  }
}

function initBuffers() {
  const cubeVertices = new Float32Array([
    -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,
    -0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
     0.5, -0.5,  0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,
     0.5, -0.5,  0.5,   0.5,  0.5, -0.5,   0.5,  0.5,  0.5,
    -0.5, -0.5, -0.5,  -0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,
    -0.5, -0.5, -0.5,  -0.5,  0.5,  0.5,  -0.5,  0.5, -0.5,
    -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5, -0.5,  0.5,
    -0.5, -0.5, -0.5,   0.5, -0.5,  0.5,  -0.5, -0.5,  0.5,
    -0.5,  0.5,  0.5,   0.5,  0.5,  0.5,   0.5,  0.5, -0.5,
    -0.5,  0.5,  0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
     0.5, -0.5, -0.5,  -0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,
     0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,   0.5,  0.5, -0.5
  ]);

  g_buffers.cube = createBufferInfo(cubeVertices);
  g_buffers.cone = createBufferInfo(buildConeVertices(24));
}

function buildConeVertices(segments) {
  const verts = [];
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * 0.5;
    const z0 = Math.sin(a0) * 0.5;
    const x1 = Math.cos(a1) * 0.5;
    const z1 = Math.sin(a1) * 0.5;

    verts.push(0, 0.5, 0, x0, -0.5, z0, x1, -0.5, z1);
    verts.push(0, -0.5, 0, x1, -0.5, z1, x0, -0.5, z0);
  }
  return new Float32Array(verts);
}

function createBufferInfo(vertices) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  return {
    buffer,
    count: vertices.length / 3
  };
}

function tick() {
  const now = performance.now();
  const deltaMs = now - g_lastFrameTime;
  g_lastFrameTime = now;
  g_seconds = now / 1000;
  g_smoothedFps = g_smoothedFps === 0 ? 1000 / deltaMs : g_smoothedFps * 0.9 + (1000 / deltaMs) * 0.1;

  updateAnimationAngles();
  renderScene();

  document.getElementById("perf").textContent = `FPS: ${g_smoothedFps.toFixed(1)}`;
  requestAnimationFrame(tick);
}

function updateAnimationAngles() {
  Object.assign(g_live, g_state);

  if (g_animationOn) {
    const stride = Math.sin(g_seconds * 4.2);
    const counter = Math.sin(g_seconds * 4.2 + Math.PI);
    const bounce = Math.abs(Math.sin(g_seconds * 4.2));

    g_live.flUpper = 22 * stride;
    g_live.frUpper = 22 * counter;
    g_live.blUpper = 18 * counter;
    g_live.brUpper = 18 * stride;

    g_live.flLower = -22 - 18 * Math.max(0, counter);
    g_live.frLower = -22 - 18 * Math.max(0, stride);
    g_live.blLower = -10 - 14 * Math.max(0, stride);
    g_live.brLower = -10 - 14 * Math.max(0, counter);

    g_live.flHoof = 8 + 8 * Math.max(0, stride);
    g_live.frHoof = 8 + 8 * Math.max(0, counter);
    g_live.blHoof = 10 + 5 * Math.max(0, counter);
    g_live.brHoof = 10 + 5 * Math.max(0, stride);

    g_live.head = g_state.head + 4 * Math.sin(g_seconds * 2.2);
    g_live.tail = g_state.tail + 18 * Math.sin(g_seconds * 7.0);
    g_live.bodyBob = 0.02 * bounce;
  } else {
    g_live.bodyBob = 0;
  }

  if (g_seconds < g_pokeUntil) {
    const pokeT = (g_pokeUntil - g_seconds) / 1.2;
    const kick = Math.sin((1 - pokeT) * Math.PI * 4);
    g_live.head = -25 + 14 * kick;
    g_live.tail = 35 * kick;
    g_live.flUpper = -45;
    g_live.frUpper = -45;
    g_live.flLower = -5 + 10 * kick;
    g_live.frLower = -5 + 10 * kick;
    g_live.blUpper += 18 * kick;
    g_live.brUpper += 18 * kick;
    g_live.bodyBob = 0.08 * Math.sin((1 - pokeT) * Math.PI);
  }
}

function renderScene() {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const globalMatrix = new Matrix4()
    .rotate(g_live.globalY ?? g_state.globalY, 0, 1, 0)
    .rotate(g_live.globalX ?? g_state.globalX, 1, 0, 0);
  gl.uniformMatrix4fv(u_GlobalRotation, false, globalMatrix.elements);

  const bodyRoot = new Matrix4().translate(0, -0.08 + (g_live.bodyBob || 0), 0);

  const body = bodyRoot.clone();
  drawCube(body.clone().scale(0.72, 0.34, 0.34), [0.85, 0.80, 0.70, 1]);

  const chest = bodyRoot.clone().translate(0.18, 0.04, 0);
  drawCube(chest.clone().scale(0.28, 0.28, 0.30), [0.88, 0.83, 0.74, 1]);

  const belly = bodyRoot.clone().translate(0.02, -0.12, 0);
  drawCube(belly.clone().scale(0.55, 0.10, 0.28), [0.79, 0.72, 0.60, 1]);

  const neckBase = bodyRoot.clone().translate(0.34, 0.12, 0).rotate(-18, 0, 0, 1);
  drawCube(neckBase.clone().translate(0.08, 0.08, 0).scale(0.16, 0.24, 0.18), [0.84, 0.79, 0.68, 1]);

  const headBase = neckBase.clone().translate(0.14, 0.20, 0).rotate(g_live.head, 0, 0, 1);
  drawCube(headBase.clone().translate(0.12, 0.02, 0).scale(0.28, 0.20, 0.20), [0.92, 0.87, 0.77, 1]);
  drawCube(headBase.clone().translate(0.28, -0.02, 0).scale(0.16, 0.12, 0.12), [0.96, 0.91, 0.82, 1]);

  drawCube(headBase.clone().translate(0.16, 0.14, 0.08).scale(0.08, 0.14, 0.05), [0.74, 0.66, 0.56, 1]);
  drawCube(headBase.clone().translate(0.16, 0.14, -0.08).scale(0.08, 0.14, 0.05), [0.74, 0.66, 0.56, 1]);

  drawCone(headBase.clone().translate(0.03, 0.18, 0.07).rotate(-85, 0, 0, 1).rotate(-18, 1, 0, 0).scale(0.08, 0.18, 0.08), [0.45, 0.36, 0.28, 1]);
  drawCone(headBase.clone().translate(0.03, 0.18, -0.07).rotate(-85, 0, 0, 1).rotate(18, 1, 0, 0).scale(0.08, 0.18, 0.08), [0.45, 0.36, 0.28, 1]);

  drawCube(headBase.clone().translate(0.35, -0.02, 0.045).scale(0.03, 0.03, 0.03), [0.12, 0.12, 0.12, 1]);
  drawCube(headBase.clone().translate(0.35, -0.02, -0.045).scale(0.03, 0.03, 0.03), [0.12, 0.12, 0.12, 1]);

  const tailBase = bodyRoot.clone().translate(-0.36, 0.06, 0).rotate(g_live.tail, 0, 0, 1);
  drawCube(tailBase.clone().translate(-0.10, 0.03, 0).scale(0.18, 0.06, 0.06), [0.82, 0.75, 0.64, 1]);
  drawCube(tailBase.clone().translate(-0.20, 0.06, 0).scale(0.08, 0.10, 0.08), [0.93, 0.92, 0.90, 1]);

  drawLeg(bodyRoot,  0.22, -0.16,  0.12, g_live.flUpper, g_live.flLower, g_live.flHoof, true);
  drawLeg(bodyRoot,  0.22, -0.16, -0.12, g_live.frUpper, g_live.frLower, g_live.frHoof, false);
  drawLeg(bodyRoot, -0.20, -0.16,  0.12, g_live.blUpper, g_live.blLower, g_live.blHoof, true);
  drawLeg(bodyRoot, -0.20, -0.16, -0.12, g_live.brUpper, g_live.brLower, g_live.brHoof, false);
}

function drawLeg(root, x, y, z, upperAngle, lowerAngle, hoofAngle, leftSide) {
  const upperLen = 0.22;
  const lowerLen = 0.18;
  const hoofLen = 0.08;
  const width = 0.08;
  const depth = 0.08;

  const legColor = leftSide ? [0.78, 0.71, 0.60, 1] : [0.80, 0.73, 0.62, 1];

  const upperBase = root.clone().translate(x, y, z).rotate(upperAngle, 0, 0, 1);
  drawCube(upperBase.clone().translate(0, -upperLen / 2, 0).scale(width, upperLen, depth), legColor);

  const lowerBase = upperBase.clone().translate(0, -upperLen, 0).rotate(lowerAngle, 0, 0, 1);
  drawCube(lowerBase.clone().translate(0, -lowerLen / 2, 0).scale(width * 0.85, lowerLen, depth * 0.85), [0.70, 0.62, 0.53, 1]);

  const hoofBase = lowerBase.clone().translate(0, -lowerLen, 0).rotate(hoofAngle, 0, 0, 1);
  drawCube(hoofBase.clone().translate(0.03, -hoofLen / 2, 0).scale(0.11, hoofLen, 0.09), [0.20, 0.16, 0.13, 1]);
}

function drawCube(matrix, color) {
  drawShape(g_buffers.cube, matrix, color);
}

function drawCone(matrix, color) {
  drawShape(g_buffers.cone, matrix, color);
}

function drawShape(bufferInfo, matrix, color) {
  gl.uniformMatrix4fv(u_ModelMatrix, false, matrix.elements);
  gl.uniform4f(u_FragColor, color[0], color[1], color[2], color[3]);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufferInfo.buffer);
  gl.vertexAttribPointer(a_Position, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(a_Position);
  gl.drawArrays(gl.TRIANGLES, 0, bufferInfo.count);
}

function initShaders(glContext, vertexSource, fragmentSource) {
  const vertexShader = loadShader(glContext, glContext.VERTEX_SHADER, vertexSource);
  const fragmentShader = loadShader(glContext, glContext.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    return false;
  }

  const program = glContext.createProgram();
  if (!program) {
    return false;
  }

  glContext.attachShader(program, vertexShader);
  glContext.attachShader(program, fragmentShader);
  glContext.linkProgram(program);

  if (!glContext.getProgramParameter(program, glContext.LINK_STATUS)) {
    console.error("Failed to link program:", glContext.getProgramInfoLog(program));
    glContext.deleteProgram(program);
    glContext.deleteShader(fragmentShader);
    glContext.deleteShader(vertexShader);
    return false;
  }

  glContext.useProgram(program);
  glContext.program = program;
  return true;
}

function loadShader(glContext, type, source) {
  const shader = glContext.createShader(type);
  if (shader == null) {
    return null;
  }

  glContext.shaderSource(shader, source);
  glContext.compileShader(shader);

  if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
    console.error("Shader compile error:", glContext.getShaderInfoLog(shader));
    glContext.deleteShader(shader);
    return null;
  }

  return shader;
}

main();
