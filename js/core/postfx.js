/**
 * postfx.js — Chaîne de post-traitement minimale, sans addons externes.
 *
 * §87 du cahier des charges : bloom très subtil, color grading naturel,
 * vignette discrète. Rien de plus — le réalisme vient de la lumière,
 * pas des effets.
 *
 * Coût : une copie plein écran + un demi-traitement à ¼ de résolution.
 * Activé uniquement sur le préréglage Élevé (auto-qualité le coupe
 * d'elle-même si le framerate chute).
 */

import * as THREE from '../../vendor/three/three.module.min.js';

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Extraction des hautes lumières (à ¼ de résolution)
const BRIGHT_FRAG = `
uniform sampler2D tDiffuse;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  gl_FragColor = vec4(c * k * k, 1.0);
}`;

// Flou gaussien séparable 9 taps
const BLUR_FRAG = `
uniform sampler2D tDiffuse;
uniform vec2 uDir;      // (1/w, 0) ou (0, 1/h)
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227;
  sum += texture2D(tDiffuse, vUv + uDir * 1.3846).rgb * 0.316;
  sum += texture2D(tDiffuse, vUv - uDir * 1.3846).rgb * 0.316;
  sum += texture2D(tDiffuse, vUv + uDir * 3.2308).rgb * 0.070;
  sum += texture2D(tDiffuse, vUv - uDir * 3.2308).rgb * 0.070;
  gl_FragColor = vec4(sum, 1.0);
}`;

// Composite : scène + bloom, grading doux, vignette
const COMPOSITE_FRAG = `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float uBloom;        // intensité du bloom (subtil)
uniform float uVignette;
uniform float uSaturation;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  vec3 b = texture2D(tBloom, vUv).rgb;
  c += b * uBloom;

  // grading naturel : ombres très légèrement froides, hautes un rien chaudes
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c += (vec3(0.012, 0.020, 0.030) * (1.0 - l) + vec3(0.024, 0.014, 0.004) * l) ;

  // vignette discrète
  vec2 d = vUv - 0.5;
  float v = 1.0 - uVignette * dot(d, d) * 2.1;
  c *= v;

  // léger grain pour casser les bandes dans les ciels sombres
  float grain = fract(sin(dot(vUv * (1.0 + fract(uTime)), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += grain * 0.012;

  gl_FragColor = vec4(c, 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = false;

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.PlaneGeometry(2, 2);

    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, { ...opts, samples: 2 });   // MSAA léger
    this.rtA = new THREE.WebGLRenderTarget(2, 2, opts);
    this.rtB = new THREE.WebGLRenderTarget(2, 2, opts);
    // La scène est encodée sRGB dans la cible (comme à l'écran) :
    // le composite ShaderMaterial sort ces valeurs telles quelles.
    this.rtScene.texture.colorSpace = THREE.SRGBColorSpace;

    this.matBright = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.68 } },
    });
    this.matBlur = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
    });
    this.matComposite = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: null }, tBloom: { value: null },
        uBloom: { value: 0.55 }, uVignette: { value: 0.30 },
        uSaturation: { value: 1.05 }, uTime: { value: 0 },
      },
    });

    this.quad = new THREE.Mesh(quad, this.matComposite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.resize();
  }

  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    if (on) this.resize();
  }

  resize() {
    const w = Math.max(2, Math.floor(this.renderer.domElement.width));
    const h = Math.max(2, Math.floor(this.renderer.domElement.height));
    this.rtScene.setSize(w, h);
    const bw = Math.max(2, Math.floor(w / 4)), bh = Math.max(2, Math.floor(h / 4));
    this.rtA.setSize(bw, bh);
    this.rtB.setSize(bw, bh);
    this.blurDir = new THREE.Vector2(1 / bw, 1 / bh);
  }

  render(scene, camera, elapsed = 0) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();

    // 1. scène → cible intermédiaire
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    // 2. hautes lumières (¼ res)
    this.quad.material = this.matBright;
    this.matBright.uniforms.tDiffuse.value = this.rtScene.texture;
    r.setRenderTarget(this.rtA);
    r.render(this.quadScene, this.quadCam);

    // 3. flou séparable (2 passes)
    this.quad.material = this.matBlur;
    this.matBlur.uniforms.tDiffuse.value = this.rtA.texture;
    this.matBlur.uniforms.uDir.value.set(this.blurDir.x, 0);
    r.setRenderTarget(this.rtB);
    r.render(this.quadScene, this.quadCam);
    this.matBlur.uniforms.tDiffuse.value = this.rtB.texture;
    this.matBlur.uniforms.uDir.value.set(0, this.blurDir.y);
    r.setRenderTarget(this.rtA);
    r.render(this.quadScene, this.quadCam);

    // 4. composite → écran
    this.quad.material = this.matComposite;
    this.matComposite.uniforms.tDiffuse.value = this.rtScene.texture;
    this.matComposite.uniforms.tBloom.value = this.rtA.texture;
    this.matComposite.uniforms.uTime.value = elapsed;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);

    r.setRenderTarget(prevTarget);
  }
}
