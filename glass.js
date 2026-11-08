const years = document.getElementById("profile-years");
function updateYears() {
  years.textContent = (new Date().getFullYear() - 2012) + "Y";
}

updateYears();
window.addEventListener("pageshow", updateYears);
document.addEventListener("visibilitychange", updateYears);
window.setInterval(updateYears, 60_000);

const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
const panels = Array.from(document.querySelectorAll(".glass"));

if ("IntersectionObserver" in window && !motion.matches) {
  const reveal = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      target.classList.add("revealed");
      reveal.unobserve(target);
    }
  });

  for (const panel of document.querySelectorAll(".other .glass")) {
    reveal.observe(panel);
  }
}

const canvas = document.querySelector(".glass-scene");
const wallpaper = new Image();

const vertexSource = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentSource = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
  #else
    precision mediump float;
  #endif

  uniform sampler2D u_wallpaper;
  uniform vec2 u_pixels;
  uniform vec2 u_scene;
  uniform vec2 u_image;
  uniform vec4 u_panel;
  uniform vec2 u_light;
  uniform float u_radius;
  uniform float u_opacity;
  uniform float u_time;

  float gaussian(float distance) {
    return exp(-distance * distance);
  }

  vec3 sceneColor(vec2 point) {
    vec2 uv = (point - u_scene * 0.5) / u_image + 0.5;
    // Keep refraction continuous when a ray leaves the edge of the wallpaper.
    vec2 mirroredUV = 1.0 - abs(mod(uv, 2.0) - 1.0);
    vec3 photo = texture2D(u_wallpaper, mirroredUV).rgb;
    float shade = dot(clamp(point / u_scene, 0.0, 1.0), vec2(0.52, 0.48));
    return mix(photo, vec3(0.018, 0.025, 0.047), 0.10 + shade * 0.34);
  }

  void main() {
    vec2 point = vec2(gl_FragCoord.x, u_pixels.y - gl_FragCoord.y) * (u_scene / u_pixels);
    if (u_radius <= 0.0) {
      gl_FragColor = vec4(sceneColor(point), 1.0);
      return;
    }

    vec2 halfSize = u_panel.zw * 0.5;
    vec2 local = point - u_panel.xy - halfSize;
    vec2 q = abs(local) - halfSize + u_radius;
    vec2 corner = max(q, 0.0);
    float depth = u_radius - length(corner) - min(max(q.x, q.y), 0.0);
    if (depth < -1.0) discard;
    vec2 outward = length(corner) > 0.001
      ? normalize(corner) * sign(local)
      : (q.x > q.y ? vec2(sign(local.x), 0.0) : vec2(0.0, sign(local.y)));

    vec2 across = local / halfSize;
    float distanceFromCenter = dot(across, across);
    float bevel = clamp(u_radius * 1.45, 34.0, 58.0);
    float lip = 1.0 - smoothstep(0.0, bevel, depth);
    float ripple = sin(dot(local, vec2(0.044, 0.033)) + u_time * 1.15);
    float slope = clamp(lip * (0.96 + ripple * 0.025), 0.0, 0.985);
    vec3 normal = vec3(outward * slope, sqrt(1.0 - slope * slope));

    // The convex face magnifies the scene. The curved lip bends it again.
    vec2 curvedFace = local * (0.075 + 0.085 * distanceFromCenter);
    vec2 warped = point - curvedFace
      + vec2(ripple, sin(local.x * 0.045 - u_time)) * lip * 2.6;

    // Refraction with a different IOR for each wavelength. Increase dispersion
    // toward the lip, where contrasting edges in the photo show the color split.
    vec3 view = vec3(0.0, 0.0, -1.0);
    vec3 redRay = refract(view, normal, 1.0 / 1.42);
    vec3 greenRay = refract(view, normal, 1.0 / 1.50);
    vec3 blueRay = refract(view, normal, 1.0 / 1.61);
    float glassDepth = bevel * 1.44;
    vec2 spectrum = outward * lip * 3.5;
    vec2 red = warped - redRay.xy * (glassDepth / -redRay.z) - spectrum;
    vec2 green = warped - greenRay.xy * (glassDepth / -greenRay.z);
    vec2 blue = warped - blueRay.xy * (glassDepth / -blueRay.z) + spectrum;
    vec3 color = vec3(sceneColor(red).r, sceneColor(green).g, sceneColor(blue).b);
    color = mix(color, vec3(0.055, 0.09, 0.155), 0.23);

    // The grazing edge reflects the scene outside the lens.
    float fresnel = 0.04 + 0.96 * pow(1.0 - normal.z, 3.0);
    vec3 reflection = sceneColor(point + outward * (14.0 + max(depth, 0.0) * 2.0 + lip * 36.0));
    color = mix(color, reflection * 0.92 + vec3(0.10, 0.13, 0.18), fresnel * 0.48);

    // A broad softbox reflection and two concentrated glints on opposite sides.
    float facing = dot(outward, u_light);
    vec2 tangent = vec2(-u_light.y, u_light.x);
    float along = dot(across, tangent);
    float source = dot(across, u_light);
    float streak = gaussian((source - 0.58 + along * 0.17) / 0.20);
    float sweep = gaussian((source - 0.22 - sin(u_time * 0.62) * 0.40) / 0.115);
    color = mix(color, vec3(0.82, 0.92, 1.0), (streak * 0.125 + sweep * 0.065) * (1.0 - lip));

    vec3 halfVector = normalize(vec3(u_light * 1.42, 1.0));
    vec3 bounceVector = normalize(vec3(-u_light * 1.15, 1.0));
    float key = pow(max(dot(normal, halfVector), 0.0), 56.0) * lip;
    float bounce = pow(max(dot(normal, bounceVector), 0.0), 65.0) * lip;
    float edge = 1.0 - smoothstep(0.35, 3.35, depth);
    float innerEdge = gaussian((depth - 5.1) / 2.1);
    float keyRim = 0.10 + 0.78 * pow(max(facing, 0.0), 2.0);
    float fillRim = 0.58 * pow(max(-facing, 0.0), 3.0);
    color *= 1.0 - innerEdge * 0.16 * (1.0 - abs(facing));
    color = mix(color, vec3(0.78, 0.87, 1.0), clamp(bounce * 0.45 + edge * fillRim, 0.0, 1.0));
    color = mix(color, vec3(0.96, 0.98, 1.0), clamp(key * 0.57 + edge * keyRim, 0.0, 1.0));

    float alpha = smoothstep(-0.65, 0.65, depth) * u_opacity;
    gl_FragColor = vec4(color, alpha);
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error);
  }
  return shader;
}

function createRenderer() {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false });
  if (!gl) return;

  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, wallpaper);
  if (gl.getError() !== gl.NO_ERROR) throw new Error("Unable to upload wallpaper");

  const uniform = {};
  for (const name of ["pixels", "scene", "image", "panel", "radius", "light", "opacity", "time"]) {
    uniform[name] = gl.getUniformLocation(program, "u_" + name);
  }
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  return function draw(seconds, pointer) {
    const scene = canvas.getBoundingClientRect();
    if (!scene.width || !scene.height) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(scene.width * dpr);
    const height = Math.round(scene.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.uniform1f(uniform.time, seconds);
    gl.uniform2f(uniform.pixels, width, height);
    gl.uniform2f(uniform.scene, scene.width, scene.height);
    const cover = Math.max(scene.width / wallpaper.naturalWidth, scene.height / wallpaper.naturalHeight);
    gl.uniform2f(uniform.image, wallpaper.naturalWidth * cover, wallpaper.naturalHeight * cover);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.uniform1f(uniform.radius, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    const scaleX = width / scene.width;
    const scaleY = height / scene.height;
    for (const panel of panels) {
      const rect = panel.getBoundingClientRect();
      const x = rect.left - scene.left;
      const y = rect.top - scene.top;
      const left = Math.max(0, Math.floor(x * scaleX - 1));
      const right = Math.min(width, Math.ceil((x + rect.width) * scaleX + 1));
      const top = Math.max(0, Math.floor(y * scaleY - 1));
      const bottom = Math.min(height, Math.ceil((y + rect.height) * scaleY + 1));
      if (right <= left || bottom <= top) continue;

      const style = getComputedStyle(panel);
      const opacity = Number(style.opacity);
      if (opacity <= 0) continue;

      const idleAngle = -1.92 + Math.sin(seconds * 0.78) * 0.53;
      let lightX = Math.cos(idleAngle);
      let lightY = Math.sin(idleAngle);
      if (pointer && !motion.matches) {
        lightX += (pointer.x - rect.left - rect.width * 0.5) / Math.max(rect.width, 1) * 1.7;
        lightY += (pointer.y - rect.top - rect.height * 0.5) / Math.max(rect.height, 1) * 1.7;
      }
      const length = Math.hypot(lightX, lightY) || 1;
      gl.uniform2f(uniform.light, lightX / length, lightY / length);
      gl.uniform4f(uniform.panel, x, y, rect.width, rect.height);
      gl.uniform1f(uniform.radius, Math.min(parseFloat(style.borderTopLeftRadius), rect.width / 2, rect.height / 2));
      gl.uniform1f(uniform.opacity, opacity);
      gl.scissor(left, height - bottom, right - left, bottom - top);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    return !gl.isContextLost();
  };
}

let drawScene;
let frame = null;
let pointer;

function schedule() {
  if (drawScene && !document.hidden && frame === null) frame = requestAnimationFrame(render);
}

function render(now) {
  frame = null;
  if (!drawScene || !drawScene(motion.matches ? 0 : now / 1000, pointer)) return;
  document.documentElement.classList.add("has-glass-scene");
  if (!motion.matches) schedule();
}

function initialize() {
  try {
    drawScene = createRenderer();
    schedule();
  } catch (error) {
    console.warn("Liquid Glass renderer unavailable:", error.message);
  }
}

canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  drawScene = null;
  document.documentElement.classList.remove("has-glass-scene");
});
canvas.addEventListener("webglcontextrestored", initialize);
window.addEventListener("scroll", schedule, { passive: true });
window.addEventListener("resize", schedule);
window.visualViewport?.addEventListener("resize", schedule);
window.visualViewport?.addEventListener("scroll", schedule);
document.addEventListener("visibilitychange", schedule);
motion.addEventListener("change", schedule);
document.addEventListener("pointermove", event => {
  if (event.pointerType === "mouse" || event.pointerType === "pen") {
    pointer = { x: event.clientX, y: event.clientY };
  }
}, { passive: true });
document.documentElement.addEventListener("pointerleave", () => { pointer = null; });

wallpaper.addEventListener("load", initialize, { once: true });
if (window.location.protocol === "file:") {
  // Browsers block WebGL uploads from file-origin images. A data URL can be
  // uploaded without relaxing that policy when index.html is opened directly.
  const textureScript = document.createElement("script");
  textureScript.src = "wallpaper-texture.js";
  textureScript.addEventListener("load", () => {
    wallpaper.src = window.localGlassWallpaper;
    delete window.localGlassWallpaper;
  }, { once: true });
  document.head.append(textureScript);
} else {
  wallpaper.src = "Wallpaper.png";
}
