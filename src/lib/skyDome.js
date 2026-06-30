// Gradient sky backdrop: large inverted sphere with zenith→horizon gradient, a sun disc/glow
// tracking the sun direction, drifting procedural clouds, and a star field that fades in at night.
// Camera-locked so the sky is never approached. Clouds are painted on the dome (infinite distance)
// rather than a separate plane — avoids the "flat ceiling" artifact when looking up.
// See docs/superpowers/specs/2026-06-29-environment-day-night-design.md

export function createSkyDome(THREE) {
	const geo = new THREE.SphereGeometry(4000, 32, 16)
	const mat = new THREE.ShaderMaterial({
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
		uniforms: {
			uZenith: { value: new THREE.Color(0x3a7bd5) },
			uHorizon: { value: new THREE.Color(0x9ec9ee) },
			uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.4) },
			uStar: { value: 0.0 },
			uTime: { value: 0.0 },
			uCloud: { value: 1.0 }, // 0 at deep night → 1 in daylight
		},
		vertexShader: `
			varying vec3 vDir;
			void main() {
				vDir = normalize(position);
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}`,
		fragmentShader: `
			uniform vec3 uZenith;
			uniform vec3 uHorizon;
			uniform vec3 uSunDir;
			uniform float uStar;
			uniform float uTime;
			uniform float uCloud;
			varying vec3 vDir;
			float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
			float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
			float vnoise(vec2 p) {
				vec2 i = floor(p); vec2 f = fract(p);
				float a = hash2(i), b = hash2(i + vec2(1.0, 0.0));
				float c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
				vec2 u = f * f * (3.0 - 2.0 * f);
				return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
			}
			float fbm(vec2 p) {
				float v = 0.0, amp = 0.5;
				for (int i = 0; i < 4; i++) { v += amp * vnoise(p); p *= 2.0; amp *= 0.5; }
				return v;
			}
			void main() {
				float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
				vec3 col = mix(uHorizon, uZenith, pow(h, 0.6));
				vec3 sdir = normalize(uSunDir);
				float d = max(dot(normalize(vDir), sdir), 0.0);
				col += vec3(1.0, 0.9, 0.7) * pow(d, 128.0);          // sun disc
				col += vec3(1.0, 0.6, 0.3) * pow(d, 4.0) * 0.25;     // horizon-ward halo
				// Clouds: project the view onto a plane above and sample drifting fbm. Only in the
				// upper hemisphere, fading out near the horizon and at night (uCloud).
				if (vDir.y > 0.02) {
					vec2 cuv = vDir.xz / vDir.y * 0.6 + vec2(uTime * 0.004, uTime * 0.002);
					float cov = smoothstep(0.50, 0.95, fbm(cuv));
					float fade = smoothstep(0.02, 0.30, vDir.y) * uCloud;
					vec3 cloudCol = mix(uHorizon, vec3(1.0), 0.6);
					col = mix(col, cloudCol, clamp(cov * fade, 0.0, 0.85));
				}
				float st = step(0.998, hash(floor(vDir * 600.0))) * uStar * smoothstep(0.0, 0.3, vDir.y);
				col += vec3(st);
				gl_FragColor = vec4(col, 1.0);
			}`,
	})
	const mesh = new THREE.Mesh(geo, mat)
	mesh.frustumCulled = false
	mesh.renderOrder = -1000 // draw first, behind everything
	return {
		mesh,
		update(palette, sunDirThree, cameraPos, dt) {
			mat.uniforms.uZenith.value.setHex(palette.skyZenith)
			mat.uniforms.uHorizon.value.setHex(palette.skyHorizon)
			mat.uniforms.uSunDir.value.set(sunDirThree.x, sunDirThree.y, sunDirThree.z)
			mat.uniforms.uStar.value = palette.starOpacity
			mat.uniforms.uCloud.value = 1.0 - palette.starOpacity // clouds fade as stars rise
			mat.uniforms.uTime.value += dt || 0
			mesh.position.copy(cameraPos)
		},
	}
}
