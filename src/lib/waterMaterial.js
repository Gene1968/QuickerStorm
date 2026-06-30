// Ocean water ShaderMaterial — FS-like constant broad/rough waves + broad sun sheen + horizon
// convergence, NO reflection pass. Extracted from useWorldEngine.js (like terrainMaterial.js).
// Ripple MOTION is carried by crest/trough COLOR bands (constant, view-independent — FS's main
// ripple is always on); the sun adds a broad sheen on top, not a tight glint. Raw ShaderMaterial
// output is sRGB-encoded here (the renderer doesn't auto-encode it → would render too dark).
import { createWaterNormalTexture } from './waterNormalTexture.js'

export function buildWaterMaterial(THREE) {
	const normalTex = createWaterNormalTexture(THREE, 256)
	return new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uNormalMap: { value: normalTex },
			// FS-measured water tones: trough / crest alternate, converging to a light horizon.
			uWaterDeep: { value: new THREE.Color(0x032c6b) },
			uWaterCrest: { value: new THREE.Color(0x7089c6) }, // brighter crest → stronger wave contrast
			uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.4) },
			uSunColor: { value: new THREE.Color(0xfff4e6) },
			uSunIntensity: { value: 1.0 },
			uExposure: { value: 1.0 },
		},
		vertexShader: `
			varying vec3 vWorld;
			void main() {
				vec4 wp = modelMatrix * vec4(position, 1.0);
				vWorld = wp.xyz;
				gl_Position = projectionMatrix * viewMatrix * wp;
			}
		`,
		fragmentShader: `
			uniform float uTime;
			uniform sampler2D uNormalMap;
			uniform vec3 uWaterDeep;
			uniform vec3 uWaterCrest;
			uniform vec3 uSunDir;
			uniform vec3 uSunColor;
			uniform float uSunIntensity;
			uniform float uExposure;
			varying vec3 vWorld;

			// linear → sRGB (raw ShaderMaterial output isn't auto-encoded → would render too dark).
			vec3 toSRGB(vec3 c) {
				c = clamp(c, 0.0, 1.0);
				return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
			}

			void main() {
				float d = distance(cameraPosition.xz, vWorld.xz);
				vec2 p = vWorld.xz;

				// BROAD, ROUGH waves — low frequencies so big features survive grazing foreshortening
				// and read at distance. RGB = normal, A = wave height (lockstep). Constant motion,
				// NOT gated by the sun (FS's main ripple is always present).
				vec4 s1 = texture2D(uNormalMap, p * 0.018 + vec2(0.8, 0.6) * uTime * 0.07);
				vec4 s2 = texture2D(uNormalMap, p * 0.06 + vec2(-0.6, 0.7) * uTime * 0.11);
				vec4 s3 = texture2D(uNormalMap, p * 0.14 + vec2(0.5, 0.9) * uTime * 0.16);
				vec3 t = normalize((s1.xyz * 2.0 - 1.0) * 1.0 + (s2.xyz * 2.0 - 1.0) * 0.7 + (s3.xyz * 2.0 - 1.0) * 0.4);
				float bumpFade = 1.0 - smoothstep(250.0, 900.0, d);
				float bump = 1.8 * bumpFade;          // rougher normals
				vec3 N = normalize(vec3(t.x * bump, t.z, t.y * bump));

				// Constant crest/trough COLOR bands — visible at every angle & far out (this is the
				// motion you actually see). High contrast; height clusters near 0.5 so amplify hard,
				// with a tight window for crisp distinct waves.
				float wh = s1.a * 0.5 + s2.a * 0.35 + s3.a * 0.15;
				wh = clamp((wh - 0.5) * 4.0 + 0.5, 0.0, 1.0);
				float bandFade = 1.0 - smoothstep(500.0, 1600.0, d);
				float band = smoothstep(0.40, 0.60, wh) * bandFade;
				// Far water resolves to the solid light crest tone — the close-wave shines coalesce into
				// the horizon water (no separate gradient; meets the sky at a sharp line).
				float crest = max(band, smoothstep(900.0, 2600.0, d));
				vec3 col = mix(uWaterDeep, uWaterCrest, crest);

				// BROAD sun sheen (not a tight dot): low exponents, wide glow. Adds on top.
				vec3 V = normalize(cameraPosition - vWorld);
				vec3 L = normalize(uSunDir);
				float ndh = max(dot(N, normalize(L + V)), 0.0);
				float sheen = (pow(ndh, 30.0) * 0.5 + pow(ndh, 8.0) * 0.12) * uSunIntensity * bumpFade;
				col += uSunColor * sheen;

				// Opaque (FS — no seabed through deep water); only a hint of clarity right at the shore.
				float op = mix(0.97, 1.0, smoothstep(10.0, 80.0, d));
				gl_FragColor = vec4(toSRGB(col * uExposure), op);
			}
		`,
		transparent: true,
		depthWrite: false,
		side: THREE.FrontSide,
	})
}
