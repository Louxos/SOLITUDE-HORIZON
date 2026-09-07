/**
 * water.js — Nappe d'eau (lacs, rivières) : plan suivant le joueur, vagues
 * de sommets, normales animées, absorption par la profondeur.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { WORLD } from '../core/config.js';
import { getTexture } from '../core/textures.js';
import { settings } from '../core/settings.js';

export class Water {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    const size = 3400;
    const seg = settings.data.quality === 'low' ? 48 : 96;
    const geom = new THREE.PlaneGeometry(size, size, seg, seg);
    geom.rotateX(-Math.PI / 2);

    const normalMap = getTexture('water');
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(120, 120);

    this.material = new THREE.MeshStandardMaterial({
      color: 0x223c44,
      roughness: 0.08,
      metalness: 0.22,
      transparent: true,
      opacity: 0.9,
      normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      depthWrite: false,
    });

    this.uniforms = {
      uTime: { value: 0 },
      uRain: { value: 0 },
      uCam: { value: new THREE.Vector3() },
    };

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uRain = this.uniforms.uRain;
      shader.uniforms.uCamPos = this.uniforms.uCam;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          varying vec3 vWorld;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float w1 = sin(wp.x * 0.14 + uTime * 1.1) * cos(wp.z * 0.11 - uTime * 0.7);
          float w2 = sin(wp.x * 0.037 - uTime * 0.42) * sin(wp.z * 0.051 + uTime * 0.33);
          transformed.y += w1 * 0.045 + w2 * 0.12;
          vWorld = wp.xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform float uRain;
          uniform vec3 uCamPos;
          varying vec3 vWorld;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float dist = length(vWorld.xz - uCamPos.xz);
          vec3 viewDir = normalize(uCamPos - vWorld);
          float fres = pow(1.0 - clamp(dot(viewDir, vec3(0.0,1.0,0.0)), 0.0, 1.0), 2.4);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.42, 0.46), fres * 0.8);
          diffuseColor.a = mix(0.72, 0.97, fres);
        `);
    };

    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.position.y = WORLD.waterLevel;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Profondeur d'eau à une position (0 = pas d'eau). */
  depthAt(x, z) {
    return Math.max(0, WORLD.waterLevel - this.terrain.height(x, z));
  }

  update(dt, camera, rainIntensity = 0) {
    this.uniforms.uTime.value += dt;
    // Défilement des normales : houle lente + agitation sous la pluie
    const nm = this.material.normalMap;
    nm.offset.x = (nm.offset.x + dt * 0.012) % 1;
    nm.offset.y = (nm.offset.y + dt * 0.009 * (1 + rainIntensity)) % 1;
    this.material.normalScale.setScalar(0.45 + rainIntensity * 0.7);
    this.uniforms.uRain.value = rainIntensity;
    this.uniforms.uCam.value.copy(camera.position);
    this.mesh.position.x = Math.round(camera.position.x / 12) * 12;
    this.mesh.position.z = Math.round(camera.position.z / 12) * 12;
  }
}
