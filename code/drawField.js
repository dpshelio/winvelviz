/**
 * Server side rendering of the streamlines from the vector field
 */
const fs = require("fs");
const path = require("path");
const streamlines = require("@anvaka/streamlines");
const { createCanvas } = require("canvas");

/**
 * These three parameters can be tweaked to modify the rendering quality.
 * To learn more about their meaning, please see https://github.com/anvaka/streamlines
 */
const dSep = 0.25;
const dTest = 0.125;
const timeStep = 1.9;

// node does not have `window.performance`, which is used by `streamlines` library:
global.window = {
  performance: require("perf_hooks").performance
};

var gradient = makeGradient([
  { stop: 0.0, r: 0x28, g: 0x28, b: 0x28 },
  { stop: 0.5, r: 0x6a, g: 0xa8, b: 0xc6 },
  { stop: 1.0, r: 0xe2, g: 0xe5, b: 0xaa }
]);

let queue = [process.argv[2]];

processNextInQueue();

function processNextInQueue() {
  if (!queue.length) return;
  var item = queue.shift();
  processItem(item).then(processNextInQueue);
}

function processItem(item) {
  console.log("processing ", item);

  const canvasWidth = 1280;
  const canvasHeight = 720;

  const canvas = createCanvas(canvasWidth, canvasHeight, "png");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#141524";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.globalAlpha = 0.5;

  const data = require("./" + path.join("data", item));
  const u = data.u;
  const v = data.v;

  var uMax = u.maximum;
  var uMin = u.minimum;
  var vMax = v.maximum;
  var vMin = v.minimum;
  var maxVelocity = Math.sqrt(uMax * uMax + vMax * vMax);
  const width = u.Ni;
  const height = u.Nj - 1;
  const vfData = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 2;
      const k = y * width + ((x + width / 2) % width);
      vfData[i + 0] = (u.values[k] - u.minimum) / (u.maximum - u.minimum);
      vfData[i + 1] = (v.values[k] - v.minimum) / (v.maximum - v.minimum);
    }
  }

  const boundingBox = {
    left: 0,
    top: 0,
    width: width,
    height: height
  };

  return streamlines({
    dSep,
    dTest,
    boundingBox: boundingBox,
    vectorField: vectorField,
    timeStep,
    maxTimePerIteration: 1000000,
    stepsPerIteration: 40000,
    onStreamlineAdded: onStreamlineAdded,
    seed: {
      x: 10,
      y: 10
    }
  })
    .run()
    .then(saveCanvas);

  function vectorField(p) {
    // We will be using interpolation, as described by https://blog.mapbox.com/how-i-built-a-wind-map-with-webgl-b63022b5537f
    var lx = Math.floor(p.x);
    var ly = Math.floor(p.y);
    var ux = Math.ceil(p.x);
    var uy = Math.ceil(p.y);

    if (lx < 0) lx = ux;
    if (ux >= width) ux = lx;
    if (ly < 0) ly = uy;
    if (uy > height) uy = ly;
    if (outside(lx, ly) || outside(ux, uy)) return;

    var tl = getXY(lx, ly);
    var tr = getXY(lx + 1, ly);
    var bl = getXY(lx, ly + 1);
    var br = getXY(lx + 1, ly + 1);

    if (!tl || !tr || !bl || !br) return;

    // use interpolation to get better details in the mid points.
    var res = mix(mix(tl, tr, p.x - lx), mix(bl, br, p.x - lx), 1 - p.y + ly);
    var p = {
      // I don't really know why we need minus. This way it matches the original wind map by Vladimir Agafonkin
      x: -(res.x * (uMax - uMin) + uMin),
      y: res.y * (vMax - vMin) + vMin
    };

    return p;
  }

  // Given vector field coordinates - read value from the wind texture.
  function getXY(x, y) {
    if (outside(x, y)) return;

    var idx = (x + y * width) * 2;
    return {
      x: vfData[idx],
      y: vfData[idx + 1]
    };
  }

  // Checks if a point is outside of the visible area.
  function outside(x, y) {
    return x < 0 || x >= width || y < 0 || y >= height;
  }

  // Linear interpolation between two points
  function mix(a, b, ratio) {
    return {
      x: a.x * ratio + (1 - ratio) * b.x,
      y: a.y * ratio + (1 - ratio) * b.y
    };
  }

  function onStreamlineAdded(points) {
    for (var i = 1; i < points.length; ++i) {
      drawSegment(points[i - 1], points[i]);
    }
  }

  function drawSegment(a, b) {
    ctx.beginPath();
    // get color in the middle of the vector.
    ctx.strokeStyle = getColor((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
    a = transform(a);
    b = transform(b);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.closePath();
  }

  // Turns vector field point into canvas point.
  function transform(pt) {
    var tx = (pt.x - boundingBox.left) / boundingBox.width;
    var ty = (pt.y - boundingBox.top) / boundingBox.height;

    return {
      x: Math.round(tx * canvasWidth),
      y: Math.round(ty * canvasHeight)
    };
  }

  function getColor(x, y) {
    var p = vectorField({ x, y });
    if (!p) return "rgba(0, 0, 0, 1.)";
    var gray = Math.sqrt(p.x * p.x + p.y * p.y) / maxVelocity;
    var c = gradient(gray);
    return (
      "rgba(" + c.r + ", " + c.g + "," + c.b + ", " + (0.1 + gray * 0.9) + ")"
    );
  }

  function saveCanvas() {
    var name = item.split(".")[0];
    ctx.fillStyle = "#fff";
    ctx.font = "18px 'Open Sans'";
    ctx.fillText(
      [name.substr(0, 4), name.substr(4, 2), name.substr(6, 2)].join("-"),
      canvasWidth - 104,
      canvasHeight - 8
    );
    const buf = canvas.toBuffer();
    fs.writeFileSync(path.join("out", item + ".png"), buf);
  }
}

function makeGradient(stops) {
  return getColor;

  function getColor(t) {
    if (t <= 0) return stops[0];
    if (t >= 1) return stops[stops.length - 1];

    var from = stops[0];

    // the array of stops is small. No need to be fancy - plain iteration is good enough
    for (var i = 1; i < stops.length; ++i) {
      var to = stops[i];
      if (from.stop <= t && t < to.stop) {
        // how far are we between these two stops?
        var dist = (t - from.stop) / (to.stop - from.stop);
        return mix(to, from, dist);
      } else {
        // Keep looking
        from = to;
      }
    }

    throw new Error("This should not be possible!");
  }

  // linear interpolation between r, g, and b components of a color
  function mix(a, b, t) {
    return {
      r: Math.round(a.r * t + (1 - t) * b.r),
      g: Math.round(a.g * t + (1 - t) * b.g),
      b: Math.round(a.b * t + (1 - t) * b.b)
    };
  }
}
