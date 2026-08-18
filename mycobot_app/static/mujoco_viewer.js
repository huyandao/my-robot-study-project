/**
 * Browser WebGL view of the MuJoCo-controlled myCobot 280.
 *
 * MuJoCo physics and IK stay in the Python backend. This renderer loads the
 * same STL assets and applies the MJCF body/joint transforms to the angles
 * returned by the backend, so the page is a live 3D view rather than a PNG or
 * video stream.
 */

const DEG_TO_RAD = Math.PI / 180;
const MESH_ROOT = "/model-assets/upstream/meshes_mujoco";
const MESH_NAMES = ["joint1_jet", "joint2", "joint3", "joint4", "joint5", "joint6", "joint7"];
const COLORS = [
  [0.18, 0.22, 0.27],
  [0.86, 0.89, 0.92],
  [0.95, 0.48, 0.12],
  [0.88, 0.91, 0.94],
  [0.95, 0.48, 0.12],
  [0.86, 0.89, 0.92],
  [0.23, 0.27, 0.32],
];

export class MujocoWebViewer {
  constructor(canvas, statusElement) {
    this.canvas = canvas;
    this.statusElement = statusElement;
    this.gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    this.angles = [0, 0, 0, 0, 0, 0];
    this.tcp = null;
    this.target = null;
    this.controlMode = "joint";
    this.connected = false;
    this.meshes = [];
    this.ready = false;
    this.camera = { yaw: -1.05, pitch: 0.38, distance: 0.72, target: [0, 0, 0.22] };
    this.pointer = null;

    if (!this.gl) {
      this.setStatus("当前浏览器不支持 WebGL2", true);
      return;
    }
    try {
      this.initializeGl();
      this.wireCamera();
      void this.loadScene();
      requestAnimationFrame(() => this.renderLoop());
    } catch (error) {
      this.setStatus(`WebGL 初始化失败：${error.message}`, true);
    }
  }

  setStatus(text, isError = false) {
    this.statusElement.textContent = text;
    this.statusElement.classList.toggle("viewer-error", isError);
  }

  update(status) {
    this.connected = Boolean(status.connected) && (status.mode || "sim") === "sim";
    if (Array.isArray(status.angles) && status.angles.length >= 6) {
      this.angles = status.angles.slice(0, 6).map((value) => Number(value) * DEG_TO_RAD);
    }
    if (Array.isArray(status.end_effector)) this.tcp = status.end_effector.map(Number);
    if (Object.hasOwn(status, "cartesian_target")) {
      this.target = Array.isArray(status.cartesian_target) ? status.cartesian_target.map(Number) : null;
    }
    if (status.gamepad_control_mode) this.controlMode = status.gamepad_control_mode;
    if (this.ready) {
      this.setStatus(this.connected
        ? `MuJoCo 已连接 · ${this.controlMode === "cartesian" ? "末端位置控制" : "六轴控制"}`
        : "模型已加载 · 等待连接 MuJoCo");
    }
  }

  initializeGl() {
    const gl = this.gl;
    const vertexSource = `#version 300 es
      precision highp float;
      layout(location=0) in vec3 aPosition;
      layout(location=1) in vec3 aNormal;
      uniform mat4 uModel;
      uniform mat4 uViewProjection;
      out vec3 vNormal;
      out vec3 vWorld;
      void main() {
        vec4 world = uModel * vec4(aPosition, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(uModel) * aNormal);
        gl_Position = uViewProjection * world;
      }`;
    const fragmentSource = `#version 300 es
      precision highp float;
      in vec3 vNormal;
      in vec3 vWorld;
      uniform vec3 uColor;
      out vec4 outColor;
      void main() {
        vec3 normal = normalize(vNormal);
        vec3 light = normalize(vec3(-0.45, -0.65, 1.0));
        float diffuse = max(dot(normal, light), 0.0);
        float fill = max(dot(normal, normalize(vec3(0.7, 0.25, 0.45))), 0.0);
        vec3 color = uColor * (0.30 + 0.62 * diffuse + 0.16 * fill);
        outColor = vec4(color, 1.0);
      }`;
    this.program = createProgram(gl, vertexSource, fragmentSource);
    this.uModel = gl.getUniformLocation(this.program, "uModel");
    this.uViewProjection = gl.getUniformLocation(this.program, "uViewProjection");
    this.uColor = gl.getUniformLocation(this.program, "uColor");
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.055, 0.075, 0.10, 1);
    this.floor = createGpuMesh(gl, createFloor());
    this.sphere = createGpuMesh(gl, createSphere(18, 12));
  }

  async loadScene() {
    this.setStatus("正在加载 myCobot 280 网格…");
    try {
      const geometry = await Promise.all(MESH_NAMES.map(async (name) => {
        const response = await fetch(`${MESH_ROOT}/${name}.stl`);
        if (!response.ok) throw new Error(`${name}.stl: HTTP ${response.status}`);
        return parseBinaryStl(await response.arrayBuffer());
      }));
      this.meshes = geometry.map((item) => createGpuMesh(this.gl, item));
      this.ready = true;
      this.setStatus(this.connected ? "MuJoCo 已连接" : "模型已加载 · 等待连接 MuJoCo");
    } catch (error) {
      this.setStatus(`模型加载失败：${error.message}`, true);
    }
  }

  wireCamera() {
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => {
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, button: event.button };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.pointer || event.pointerId !== this.pointer.id) return;
      const dx = event.clientX - this.pointer.x;
      const dy = event.clientY - this.pointer.y;
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      if (this.pointer.button === 2 || event.shiftKey) {
        const scale = this.camera.distance * 0.0015;
        this.camera.target[0] += (-Math.sin(this.camera.yaw) * dx + Math.cos(this.camera.yaw) * dy) * scale;
        this.camera.target[1] += (Math.cos(this.camera.yaw) * dx + Math.sin(this.camera.yaw) * dy) * scale;
        this.camera.target[2] += dy * scale * 0.5;
      } else {
        this.camera.yaw -= dx * 0.008;
        this.camera.pitch = clamp(this.camera.pitch - dy * 0.008, -1.25, 1.25);
      }
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (this.pointer?.id === event.pointerId) this.pointer = null;
    });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.camera.distance = clamp(this.camera.distance * Math.exp(event.deltaY * 0.001), 0.25, 1.8);
    }, { passive: false });
  }

  renderLoop() {
    this.render();
    requestAnimationFrame(() => this.renderLoop());
  }

  render() {
    const gl = this.gl;
    if (!gl) return;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    const cp = Math.cos(this.camera.pitch);
    const eye = [
      this.camera.target[0] + this.camera.distance * cp * Math.cos(this.camera.yaw),
      this.camera.target[1] + this.camera.distance * cp * Math.sin(this.camera.yaw),
      this.camera.target[2] + this.camera.distance * Math.sin(this.camera.pitch),
    ];
    const viewProjection = multiply(
      perspective(45 * DEG_TO_RAD, width / height, 0.01, 5),
      lookAt(eye, this.camera.target, [0, 0, 1]),
    );
    gl.uniformMatrix4fv(this.uViewProjection, false, viewProjection);

    this.draw(this.floor, identity(), [0.16, 0.19, 0.23]);
    if (!this.ready) return;

    const q = this.angles;
    this.draw(this.meshes[0], quaternion(0.000796327, 0, 0, 1), COLORS[0]);

    const joint2 = compose(translation(0, 0, 0.15756), rotationZ(q[0]));
    this.draw(this.meshes[1], compose(joint2, translation(0, 0, -0.06096), quaternion(0.707105, 0, 0, -0.707108)), COLORS[1]);

    const joint3 = compose(joint2, translation(0, 0, -0.001), quaternion(0.499998, 0.500002, 0.5, -0.5), rotationZ(q[1]));
    this.draw(this.meshes[2], compose(joint3, translation(0, 0, 0.03256), quaternion(0.707105, 0, -0.707108, 0)), COLORS[2]);

    const joint4 = compose(joint3, translation(-0.1104, 0, 0), rotationZ(q[2]));
    this.draw(this.meshes[3], compose(joint4, translation(0, 0, 0.03056), quaternion(0.707105, 0, -0.707108, 0)), COLORS[3]);

    const joint5 = compose(joint4, translation(-0.096, 0, 0.06462), quaternion(0.707105, 0, 0, -0.707108), rotationZ(q[3]));
    this.draw(this.meshes[4], compose(joint5, translation(0, 0, -0.03356), quaternion(0.707105, -0.707108, 0, 0)), COLORS[4]);

    const joint6 = compose(joint5, translation(0, -0.07318, 0), quaternion(0.499998, 0.5, -0.5, 0.500002), rotationZ(q[4]));
    this.draw(this.meshes[5], compose(joint6, translation(0, 0, -0.038)), COLORS[5]);

    const flange = compose(joint6, translation(0, 0.0456, 0), quaternion(0.707105, -0.707108, 0, 0), rotationZ(q[5]));
    this.draw(this.meshes[6], compose(flange, translation(0, 0, -0.012)), COLORS[6]);

    if (this.tcp) this.draw(this.sphere, compose(translation(...this.tcp), scaling(0.008)), [0.1, 0.9, 0.42]);
    if (this.controlMode === "cartesian" && this.target) {
      this.draw(this.sphere, compose(translation(...this.target), scaling(0.012)), [1.0, 0.12, 0.06]);
    }
  }

  draw(mesh, model, color) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.uModel, false, model);
    gl.uniform3fv(this.uColor, color);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
}

export function parseBinaryStl(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 84) throw new Error("STL 文件过短");
  const triangleCount = view.getUint32(80, true);
  if (84 + triangleCount * 50 > buffer.byteLength) throw new Error("仅支持二进制 STL");
  const positions = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = 84 + triangle * 50;
    const normal = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const source = offset + 12 + vertex * 12;
      const target = triangle * 9 + vertex * 3;
      positions[target] = view.getFloat32(source, true);
      positions[target + 1] = view.getFloat32(source + 4, true);
      positions[target + 2] = view.getFloat32(source + 8, true);
      normals.set(normal, target);
    }
  }
  return { positions, normals };
}

export function computeWebTcp(angles) {
  const q = angles.length >= 6 ? angles : [0, 0, 0, 0, 0, 0];
  const joint2 = compose(translation(0, 0, 0.15756), rotationZ(q[0]));
  const joint3 = compose(joint2, translation(0, 0, -0.001), quaternion(0.499998, 0.500002, 0.5, -0.5), rotationZ(q[1]));
  const joint4 = compose(joint3, translation(-0.1104, 0, 0), rotationZ(q[2]));
  const joint5 = compose(joint4, translation(-0.096, 0, 0.06462), quaternion(0.707105, 0, 0, -0.707108), rotationZ(q[3]));
  const joint6 = compose(joint5, translation(0, -0.07318, 0), quaternion(0.499998, 0.5, -0.5, 0.500002), rotationZ(q[4]));
  const flange = compose(joint6, translation(0, 0.0456, 0), quaternion(0.707105, -0.707108, 0, 0), rotationZ(q[5]));
  const tcp = compose(flange, translation(0, 0, 0.035));
  return [tcp[12], tcp[13], tcp[14]];
}

function createGpuMesh(gl, { positions, normals }) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, count: positions.length / 3 };
}

function createFloor() {
  const positions = new Float32Array([-0.8, -0.8, 0, 0.8, -0.8, 0, 0.8, 0.8, 0, -0.8, -0.8, 0, 0.8, 0.8, 0, -0.8, 0.8, 0]);
  const normals = new Float32Array(18);
  for (let index = 2; index < normals.length; index += 3) normals[index] = 1;
  return { positions, normals };
}

function createSphere(longitudes, latitudes) {
  const positions = [];
  const normals = [];
  const point = (lon, lat) => {
    const theta = lon / longitudes * Math.PI * 2;
    const phi = lat / latitudes * Math.PI;
    return [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)];
  };
  for (let lat = 0; lat < latitudes; lat += 1) {
    for (let lon = 0; lon < longitudes; lon += 1) {
      const a = point(lon, lat);
      const b = point(lon + 1, lat);
      const c = point(lon + 1, lat + 1);
      const d = point(lon, lat + 1);
      for (const vertex of [a, b, c, a, c, d]) {
        positions.push(...vertex);
        normals.push(...vertex);
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
}

function createProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function multiply(a, b) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) result[column * 4 + row] += a[index * 4 + row] * b[column * 4 + index];
    }
  }
  return result;
}

function compose(...matrices) {
  return matrices.reduce((result, matrix) => multiply(result, matrix), identity());
}

function translation(x, y, z) {
  const matrix = identity();
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return matrix;
}

function scaling(value) {
  const matrix = identity();
  matrix[0] = value;
  matrix[5] = value;
  matrix[10] = value;
  return matrix;
}

function rotationZ(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float32Array([cosine, sine, 0, 0, -sine, cosine, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function quaternion(w, x, y, z) {
  const length = Math.hypot(w, x, y, z) || 1;
  w /= length; x /= length; y /= length; z /= length;
  return new Float32Array([
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ]);
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function lookAt(eye, target, up) {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
