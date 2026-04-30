const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const canvas = document.querySelector("#canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const emptyState = document.querySelector("#emptyState");
const classificationEl = document.querySelector("#classification");
const confidenceEl = document.querySelector("#confidence");
const brightnessEl = document.querySelector("#brightness");
const saturationEl = document.querySelector("#saturation");
const edgeDensityEl = document.querySelector("#edgeDensity");
const warmPixelsEl = document.querySelector("#warmPixels");
const paletteEl = document.querySelector("#palette");

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) loadImageFile(file);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer.files?.[0];
  if (file) loadImageFile(file);
});

function loadImageFile(file) {
  if (!file.type.startsWith("image/")) return;

  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => drawAndAnalyze(image);
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function drawAndAnalyze(image) {
  const stageWidth = canvas.clientWidth || 900;
  const stageHeight = canvas.clientHeight || 620;
  const ratio = Math.min(stageWidth / image.width, stageHeight / image.height);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const x = Math.round((stageWidth - width) / 2);
  const y = Math.round((stageHeight - height) / 2);

  canvas.width = stageWidth;
  canvas.height = stageHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e8eee9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, x, y, width, height);
  emptyState.classList.add("is-hidden");

  const data = ctx.getImageData(x, y, width, height);
  renderAnalysis(analyzePixels(data, width, height));
}

function analyzePixels(imageData, width, height) {
  const data = imageData.data;
  const sampleStep = Math.max(1, Math.floor(Math.sqrt((width * height) / 18000)));
  const buckets = new Map();
  let total = 0;
  let brightness = 0;
  let saturation = 0;
  let warm = 0;
  let skinLike = 0;
  let blueGreen = 0;

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      if (a < 32) continue;

      const hsl = rgbToHsl(r, g, b);
      brightness += hsl.l;
      saturation += hsl.s;
      if (r > b + 18 && r > g - 8) warm += 1;
      if (r > 95 && g > 45 && b > 25 && r > g && g > b && Math.abs(r - g) > 12) skinLike += 1;
      if ((hsl.h > 75 && hsl.h < 230) && hsl.s > 0.18) blueGreen += 1;

      const key = quantizeColor(r, g, b);
      buckets.set(key, (buckets.get(key) || 0) + 1);
      total += 1;
    }
  }

  const edges = estimateEdges(data, width, height, sampleStep);
  const palette = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, count]) => ({ color: keyToHex(key), share: count / total }));

  const metrics = {
    brightness: brightness / total,
    saturation: saturation / total,
    warm: warm / total,
    skinLike: skinLike / total,
    blueGreen: blueGreen / total,
    edgeDensity: edges
  };

  return {
    palette,
    metrics,
    label: classify(metrics)
  };
}

function estimateEdges(data, width, height, sampleStep) {
  let strongEdges = 0;
  let checked = 0;
  const stride = Math.max(2, sampleStep * 2);

  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const center = luminanceAt(data, width, x, y);
      const right = luminanceAt(data, width, x + 1, y);
      const down = luminanceAt(data, width, x, y + 1);
      const delta = Math.abs(center - right) + Math.abs(center - down);
      if (delta > 54) strongEdges += 1;
      checked += 1;
    }
  }

  return checked ? strongEdges / checked : 0;
}

function luminanceAt(data, width, x, y) {
  const index = (y * width + x) * 4;
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

function classify(metrics) {
  if (metrics.edgeDensity > 0.34 && metrics.saturation < 0.18) {
    return {
      name: "Document or diagram",
      detail: "High edge density and low color variation suggest text, charts, diagrams, or scanned material."
    };
  }

  if (metrics.skinLike > 0.16 && metrics.edgeDensity < 0.32) {
    return {
      name: "Portrait-style image",
      detail: "Skin-tone clusters and moderate edges suggest a people-focused image."
    };
  }

  if (metrics.blueGreen > 0.42 && metrics.brightness > 0.38) {
    return {
      name: "Landscape-like image",
      detail: "Green and blue color regions dominate the sampled pixels."
    };
  }

  if (metrics.edgeDensity > 0.28) {
    return {
      name: "Textured technical image",
      detail: "Dense local contrast suggests patterns, interfaces, product details, or technical material."
    };
  }

  if (metrics.brightness < 0.24) {
    return {
      name: "Low-light image",
      detail: "The sampled pixels are mostly dark, with limited highlight coverage."
    };
  }

  return {
    name: "General image",
    detail: "The image has balanced color and contrast without one dominant visual signal."
  };
}

function quantizeColor(r, g, b) {
  const q = 32;
  return [
    Math.min(255, Math.round(r / q) * q),
    Math.min(255, Math.round(g / q) * q),
    Math.min(255, Math.round(b / q) * q)
  ].join(",");
}

function keyToHex(key) {
  return `#${key.split(",").map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl(r, g, b) {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === nr) h = 60 * (((ng - nb) / delta) % 6);
    if (max === ng) h = 60 * ((nb - nr) / delta + 2);
    if (max === nb) h = 60 * ((nr - ng) / delta + 4);
  }

  return { h: (h + 360) % 360, s, l };
}

function renderAnalysis(result) {
  classificationEl.textContent = result.label.name;
  confidenceEl.textContent = result.label.detail;
  brightnessEl.textContent = `${Math.round(result.metrics.brightness * 100)}%`;
  saturationEl.textContent = `${Math.round(result.metrics.saturation * 100)}%`;
  edgeDensityEl.textContent = `${Math.round(result.metrics.edgeDensity * 100)}%`;
  warmPixelsEl.textContent = `${Math.round(result.metrics.warm * 100)}%`;

  paletteEl.innerHTML = "";
  result.palette.forEach((item) => {
    const row = document.createElement("div");
    row.className = "swatch";

    const chip = document.createElement("span");
    chip.className = "swatch-chip";
    chip.style.backgroundColor = item.color;

    const code = document.createElement("span");
    code.className = "swatch-code";
    code.textContent = item.color;

    const share = document.createElement("span");
    share.className = "swatch-share";
    share.textContent = `${Math.round(item.share * 100)}%`;

    row.append(chip, code, share);
    paletteEl.append(row);
  });
}
