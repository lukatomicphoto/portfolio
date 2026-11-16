/* WebGL stage: one full-screen quad, the fragment shader works out which column a pixel
   belongs to and draws that column's photograph with cover-fit, squash & stretch,
   chromatic split, light, grain, blur and the dark gallery texture.
   Returns null if WebGL2 is unavailable — the DOM fallback in app.js then takes over. */
window.createStageGL = function (canvas, N) {
  'use strict';
  if (N !== 6) return null;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;

  const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

  const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes, uPtr;
uniform float uAxis, uTime, uAny, uDark, uBlur, uShift, uDpr, uPress, uWarp;
uniform float uB[7], uQ[6], uLag[6], uA[6], uF[6], uHv[6], uOp[6], uIn[6], uZoom[6], uLod[6], uHas[6];
uniform sampler2D uT0, uT1, uT2, uT3, uT4, uT5;

vec3 tex(int i, vec2 uv, float l){
  if (i == 0) return textureLod(uT0, uv, l).rgb;
  if (i == 1) return textureLod(uT1, uv, l).rgb;
  if (i == 2) return textureLod(uT2, uv, l).rgb;
  if (i == 3) return textureLod(uT3, uv, l).rgb;
  if (i == 4) return textureLod(uT4, uv, l).rgb;
  return textureLod(uT5, uv, l).rgb;
}
float hash(vec2 q){ q = fract(q * vec2(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x * q.y); }
float vnoise(vec2 q){
  vec2 i = floor(q), f = fract(q); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  bool ax = uAxis > .5;
  float a = ax ? px.x : px.y;
  float Cs = ax ? uRes.y : uRes.x;
  vec3 bg = vec3(.039, .039, .043);
  float grain = hash(px + fract(uTime) * 91.7) - .5;
  if (a < uB[0]) { o = vec4(bg + grain * .012, 1.); return; }

  int i = 0;
  for (int k = 1; k < 6; k++) if (a >= uB[k]) i = k;
  float b0 = uB[i], b1 = uB[i + 1], s = max(b1 - b0, 1.);
  float hv = uHv[i], op = uOp[i], q = uQ[i];

  // cover-fit to the current slice: at rest the photo is as large as the height allows, no more
  vec2 sl = ax ? vec2(s, Cs) : vec2(Cs, s);
  float hfit = max(sl.y, sl.x / uA[i]) * uZoom[i] * (1. + uIn[i] * .22);
  float wfit = hfit * uA[i];
  // squash & stretch, volume preserving: squeezed along the axis → bulges across it
  float qa = pow(q, .5), qc = pow(q, -.2);
  vec2 dims = ax ? vec2(max(wfit * qa, s), hfit * max(qc, 1.)) : vec2(wfit * max(qc, 1.), max(hfit * qa, s));
  float fitA = ax ? dims.x : dims.y;
  float along = b0 + s * .5 + (.5 - uF[i]) * (fitA - s) + uLag[i];
  vec2 cen = ax ? vec2(along, Cs * .5) : vec2(Cs * .5, along);
  // pointer parallax lives inside the zoom margin, so it can never reveal an edge
  vec2 par = clamp((uPtr - cen) / uRes, -1., 1.);
  cen -= par * (uZoom[i] - 1.) * .9 * dims * hv;
  cen.y += uShift * op + uIn[i] * uRes.y * .06;

  vec2 uv = (px - cen) / dims + .5;
  // a soft lens that trails the pointer while it moves
  vec2 dp = (px - uPtr) / (Cs * .32);
  uv -= dp * exp(-dot(dp, dp) * 2.2) * uWarp * hv * .035;

  float lod = uLod[i] + uBlur * op;
  vec3 col;
  if (uBlur * op > .05) {
    vec2 t = vec2(exp2(lod) * .75) / vec2(textureSize(uT0, 0));
    col = (tex(i, uv, lod) * 2. + tex(i, uv + t, lod) + tex(i, uv - t, lod) + tex(i, uv + vec2(t.x, -t.y), lod) + tex(i, uv + vec2(-t.x, t.y), lod)) / 6.;
  } else {
    float ca = (q - 1.) * .013 + uPress * hv * .0016;
    vec2 d = ax ? vec2(ca, 0.) : vec2(0., ca);
    col = vec3(tex(i, uv + d, lod).r, tex(i, uv, lod).g, tex(i, uv - d, lod).b);
  }
  col = mix(bg, col, uHas[i]);

  // grade: the column under the pointer is in full colour, the rest step back
  float act = max(hv, op);
  float lum = dot(col, vec3(.299, .587, .114));
  col = mix(vec3(lum), col, mix(mix(.94, .42, uAny), 1., act));
  col *= mix(mix(.82, .5, uAny), 1., act);
  col = mix(col, col * col * (3. - 2. * col), .18 * hv * (1. - op));

  // light: a soft pool under the pointer, and the raised column shades its neighbours
  float dl = distance(px, uPtr) / (Cs * .6);
  col *= 1. + .2 * hv * (1. - op) * exp(-dl * dl * 2.4);
  float hl = i > 0 ? uHv[i - 1] : 0., hr = i < 5 ? uHv[i + 1] : 0., w = 30. * uDpr;
  col *= 1. - .55 * (1. - hv) * (1. - op) * (hl * exp(-(a - b0) / w) + hr * exp(-(b1 - a) / w));
  col *= mix(1., mix(.5, 1., smoothstep(0., 1.3 * uDpr, min(a - b0, b1 - a))), (1. - op) * step(2.5 * uDpr, s));

  // gallery: instead of flat black, the photo sinks into a dark, finely textured surface
  float gy = px.y / uRes.y;
  float dk = clamp(op * (uDark + smoothstep(.2, 1., gy) * .34), 0., .94);
  vec2 tp = px / uDpr;
  float fine = hash(floor(tp * 1.1)) - .5;
  float fibre = vnoise(tp * vec2(.9, .035)) - .5;
  float cloud = vnoise(tp * .0045) * .6 + vnoise(tp * .019) * .4;
  vec3 dtex = vec3(.034, .034, .038) * (.55 + .9 * cloud) + fine * .03 + fibre * .014;
  col = mix(col, dtex, dk);

  vec2 vg = px / uRes - .5;
  col *= 1. - .3 * smoothstep(.35, .95, length(vg * vec2(1., .85)) * 1.25);
  col += grain * .034;
  col = mix(bg, col, clamp(1. - uIn[i], 0., 1.));
  o = vec4(col, 1.);
}`;

  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); return null; }
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  ['uRes', 'uPtr', 'uAxis', 'uTime', 'uAny', 'uDark', 'uBlur', 'uShift', 'uDpr', 'uPress', 'uWarp',
    'uB', 'uQ', 'uLag', 'uA', 'uF', 'uHv', 'uOp', 'uIn', 'uZoom', 'uLod', 'uHas'].forEach(n => { U[n] = gl.getUniformLocation(prog, n); });

  const has = new Float32Array(N), texH = new Float32Array(N).fill(1);
  const maxSide = Math.min(2560, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  for (let i = 0; i < N; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([10, 10, 11, 255]));
    gl.uniform1i(gl.getUniformLocation(prog, 'uT' + i), i);
  }

  let dpr = 1;
  return {
    texH,
    setImage(i, img) {
      const sc = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      let src = img;
      if (sc < 1) {
        src = document.createElement('canvas');
        src.width = Math.round(img.naturalWidth * sc); src.height = Math.round(img.naturalHeight * sc);
        const c = src.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(img, 0, 0, src.width, src.height);
      }
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      has[i] = 1; texH[i] = src.height || img.naturalHeight;
    },
    resize(w, h) {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      return dpr;
    },
    get dpr() { return dpr; },
    draw(u) {
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform2f(U.uPtr, u.ptrX * dpr, u.ptrY * dpr);
      gl.uniform1f(U.uAxis, u.axisX ? 1 : 0); gl.uniform1f(U.uTime, u.time); gl.uniform1f(U.uAny, u.any);
      gl.uniform1f(U.uDark, u.dark); gl.uniform1f(U.uBlur, u.blur); gl.uniform1f(U.uShift, u.shift * dpr);
      gl.uniform1f(U.uDpr, dpr); gl.uniform1f(U.uPress, u.press); gl.uniform1f(U.uWarp, u.warp);
      gl.uniform1fv(U.uB, u.B); gl.uniform1fv(U.uQ, u.Q); gl.uniform1fv(U.uLag, u.lag); gl.uniform1fv(U.uA, u.A);
      gl.uniform1fv(U.uF, u.F); gl.uniform1fv(U.uHv, u.hv); gl.uniform1fv(U.uOp, u.op); gl.uniform1fv(U.uIn, u.intro);
      gl.uniform1fv(U.uZoom, u.zoom); gl.uniform1fv(U.uLod, u.lod); gl.uniform1fv(U.uHas, has);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
};
