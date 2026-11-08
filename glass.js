const updateYears = () => {
  document.getElementById("profile-years").textContent = `${new Date().getFullYear() - 2012}Y`;
};

updateYears();
window.addEventListener("pageshow", updateYears);
document.addEventListener("visibilitychange", updateYears);
window.setInterval(updateYears, 60_000);

const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
const panels = [...document.querySelectorAll(".glass")];

if ("IntersectionObserver" in window && !motion.matches) {
  const reveal = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      target.classList.remove("reveal-pending");
      reveal.unobserve(target);
    }
  }, { rootMargin: "0px 0px -6% 0px" });

  for (const panel of document.querySelectorAll(".other .glass")) {
    panel.classList.add("reveal-pending");
    reveal.observe(panel);
  }
}

const svgElement = name => document.createElementNS("http://www.w3.org/2000/svg", name);
const mapCanvas = document.createElement("canvas");
const mapContext = mapCanvas.getContext("2d");
const overscan = 32;
const displacement = 56;
const clampLight = value => Math.max(-10, Math.min(110, value));

function makeLensMap(width, height, radius) {
  const mapWidth = Math.ceil(width / 2);
  const mapHeight = Math.ceil(height / 2);
  mapCanvas.width = mapWidth;
  mapCanvas.height = mapHeight;
  const map = mapContext.createImageData(mapWidth, mapHeight);
  const halfWidth = width / 2 - overscan;
  const halfHeight = height / 2 - overscan;

  for (let row = 0; row < mapHeight; row++) {
    const y = (row + 0.5) * height / mapHeight - height / 2;
    const dy = Math.abs(y) - halfHeight + radius;
    for (let col = 0; col < mapWidth; col++) {
      const x = (col + 0.5) * width / mapWidth - width / 2;
      const dx = Math.abs(x) - halfWidth + radius;

      // The rounded rectangle's distance field gives both the depth and the edge normal.
      const cornerX = Math.max(dx, 0);
      const cornerY = Math.max(dy, 0);
      const corner = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
      const depth = radius - corner - Math.min(Math.max(dx, dy), 0);
      const normalX = corner ? cornerX / corner : Number(dx > dy);
      const normalY = corner ? cornerY / corner : Number(dy >= dx);
      const bevel = 23 * Math.exp(-Math.pow((depth - 6) / 10, 2));
      const ripple = Math.sin(y / 28 + x / 75) * 1.5;
      const shiftX = normalX * Math.sign(x) * bevel - x * 0.012 + ripple;
      const shiftY = normalY * Math.sign(y) * bevel - y * 0.012;

      const i = (row * mapWidth + col) * 4;
      map.data[i] = 255 * (0.5 + shiftX / displacement);
      map.data[i + 1] = 255 * (0.5 + shiftY / displacement);
      map.data[i + 3] = 255;
    }
  }

  mapContext.putImageData(map, 0, 0);
  return mapCanvas.toDataURL();
}

function installOptics() {
  if (!mapContext || !CSS.supports("filter", 'url("#glass-lens")')) return;

  const svg = svgElement("svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  const definitions = svgElement("defs");
  svg.append(definitions);
  document.body.prepend(svg);

  const lenses = panels.map((panel, index) => {
    const id = `glass-lens-${index}`;
    const filter = svgElement("filter");
    filter.id = id;
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("color-interpolation-filters", "sRGB");

    const map = svgElement("feImage");
    map.setAttribute("preserveAspectRatio", "none");
    map.setAttribute("result", "lens");
    const warp = svgElement("feDisplacementMap");
    warp.setAttribute("in", "SourceGraphic");
    warp.setAttribute("in2", "lens");
    warp.setAttribute("scale", displacement);
    warp.setAttribute("xChannelSelector", "R");
    warp.setAttribute("yChannelSelector", "G");
    filter.append(map, warp);
    definitions.append(filter);

    const optics = document.createElement("div");
    optics.className = "glass-optics";
    optics.setAttribute("aria-hidden", "true");
    optics.style.filter = `url("#${id}") blur(0.8px) saturate(1.22)`;
    const sheen = document.createElement("div");
    sheen.className = "glass-sheen";
    sheen.style.animationDelay = `${index * -1.7}s`;
    sheen.setAttribute("aria-hidden", "true");
    panel.prepend(optics, sheen);
    panel.classList.add("has-optics");

    return { panel, optics, filter, map, lightX: 24, lightY: 4 };
  });

  let pointer;
  let frame = null;
  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(render);
  };

  function render() {
    frame = null;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const wallpaperScale = Math.max(viewportWidth / wallpaper.naturalWidth, viewportHeight / wallpaper.naturalHeight);
    const imageWidth = wallpaper.naturalWidth * wallpaperScale;
    const imageHeight = wallpaper.naturalHeight * wallpaperScale;
    let moving = false;

    for (const lens of lenses) {
      const { panel, optics, filter, map } = lens;
      const bounds = panel.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > viewportHeight) continue;

      const width = panel.clientWidth + 2 * overscan;
      const height = panel.clientHeight + 2 * overscan;
      if (lens.width !== width || lens.height !== height || lens.viewportWidth !== viewportWidth) {
        const radius = parseFloat(getComputedStyle(panel).borderTopLeftRadius) - panel.clientLeft;
        for (const element of [filter, map]) {
          element.setAttribute("width", width);
          element.setAttribute("height", height);
        }
        map.setAttribute("href", makeLensMap(width, height, radius));
        lens.width = width;
        lens.height = height;
        lens.viewportWidth = viewportWidth;
      }

      const x = overscan - bounds.left - panel.clientLeft;
      const y = overscan - bounds.top - panel.clientTop;
      // Align the unwarped wallpaper to viewport coordinates before applying the lens.
      optics.style.backgroundSize = `${viewportWidth}px ${viewportHeight}px, ${imageWidth}px ${imageHeight}px`;
      optics.style.backgroundPosition = `${x}px ${y}px, ${x + (viewportWidth - imageWidth) / 2}px ${y + (viewportHeight - imageHeight) / 2}px`;

      const targetX = pointer ? clampLight(100 * (pointer.x - bounds.left) / bounds.width) : 24;
      const targetY = pointer ? clampLight(100 * (pointer.y - bounds.top) / bounds.height) : 4;
      const ease = motion.matches ? 1 : 0.14;
      lens.lightX += (targetX - lens.lightX) * ease;
      lens.lightY += (targetY - lens.lightY) * ease;
      panel.style.setProperty("--light-x", `${lens.lightX.toFixed(2)}%`);
      panel.style.setProperty("--light-y", `${lens.lightY.toFixed(2)}%`);

      moving ||= Math.abs(targetX - lens.lightX) > 0.05 || Math.abs(targetY - lens.lightY) > 0.05;
      moving ||= panel.getAnimations().some(animation => animation.animationName === "enter" && animation.playState === "running");
    }

    if (moving) schedule();
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  document.addEventListener("animationstart", schedule);
  const observer = new ResizeObserver(schedule);
  for (const panel of panels) observer.observe(panel);

  document.addEventListener("pointermove", event => {
    if (motion.matches || event.pointerType === "touch") return;
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  }, { passive: true });
  function resetLight() {
    pointer = null;
    schedule();
  }
  document.documentElement.addEventListener("pointerleave", resetLight);
  motion.addEventListener("change", resetLight);
  schedule();
}

const wallpaper = new Image();
wallpaper.addEventListener("load", installOptics, { once: true });
wallpaper.src = "Wallpaper.png";
