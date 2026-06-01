/** @type {import('tailwindcss').Config} */
import defaultTheme from "tailwindcss/defaultTheme";

import plugin from "tailwindcss/plugin";

export default {
	// important: true, // Add !important to all Tailwind utilities to override Bootstrap
	content: ['./index.html', './index.aspx', './src/**/*.{vue,js,ts,jsx,tsx}'],
	safelist: [
		'outline',
		'outline-2',
		'outline-4',
		'outline-8',
		'outline-offset',
	],
	theme: {
		listStyleType: {
			none: 'none',
			circle: 'circle',
			disc: 'disc',
			decimal: 'decimal',
			'disclosure-closed': 'disclosure-closed',
			'disclosure-open': 'disclosure-open',
			square: 'square',
			roman: 'upper-roman',
		},
		extend: {
			/**
			 * Fluid type anchored at 1600px (1vw = 1rem = 16px).
			 * Two-point solve: 360px (mobile) → 1600px (anchor).
			 * a = (desktop_px − mobile_px) / 12.4, b = (desktop_px − a×16) / 16
			 * Caps hit ~5K–7K; all sizes unconstrained through 4K.
			 * Rem inside clamp resolves against browser root (16px), not html.
			 */
			fontSize: {
				'2xs': ['clamp(0.5625rem, 0.081vw + 0.544rem, 0.875rem)',  { lineHeight: '1rem' }],
				xs:   ['clamp(0.6875rem, 0.081vw + 0.669rem, 1rem)',       { lineHeight: '1rem' }],
				sm:   ['clamp(0.75rem,   0.161vw + 0.714rem, 1.25rem)',    { lineHeight: '1.25rem' }],
				base: ['clamp(0.875rem,  0.161vw + 0.839rem, 1.5rem)',     { lineHeight: '1.5rem' }],
				lg:   ['clamp(1rem,      0.161vw + 0.964rem, 1.75rem)',    { lineHeight: '1.75rem' }],
				xl:   ['clamp(1.125rem,  0.161vw + 1.089rem, 2rem)',       { lineHeight: '1.75rem' }],
				'2xl': ['clamp(1.25rem,  0.323vw + 1.177rem, 2.5rem)',    { lineHeight: '2rem' }],
				'3xl': ['clamp(1.5rem,   0.484vw + 1.391rem, 3.125rem)',  { lineHeight: '2.25rem' }],
				'4xl': ['clamp(1.75rem,  0.645vw + 1.605rem, 4rem)',      { lineHeight: '2.5rem' }],
				'5xl': ['clamp(2rem,     1.290vw + 1.710rem, 6rem)',      { lineHeight: '1' }],
				'6xl': ['clamp(2.375rem, 1.774vw + 1.976rem, 8rem)',      { lineHeight: '1' }],
				'7xl': ['clamp(2.875rem, 2.097vw + 2.403rem, 10rem)',     { lineHeight: '1' }],
				'8xl': ['clamp(3.5rem,   3.226vw + 2.774rem, 14rem)',     { lineHeight: '1' }],
				'9xl': ['clamp(4.25rem,  4.839vw + 3.161rem, 20rem)',     { lineHeight: '1' }],
			},
			fontFamily: {
				montserrat: ['Montserrat', ...defaultTheme.fontFamily.sans],
				roboto: ['Roboto-Flex', ...defaultTheme.fontFamily.sans],
				sans: ['RobotoFlex', ...defaultTheme.fontFamily.sans],
				serif: ['EurostileExtended', ...defaultTheme.fontFamily.serif],
				display: [
					'EurostileExtended-Black',
					...defaultTheme.fontFamily.serif,
				],
				'eurostile-ext': 'Eurostile-Ext',
				'eurostile-med': 'Eurostile-Med',
				'roboto-flex': 'Roboto-Flex',
			},
			colors: {
				/*
				 * ── quickerSTORM colors palette ──────────────────────────────────────
				 * These reference CSS custom properties defined in index.css so that
				 * bg-card, text-t1, border-brd2, etc. automatically respond to the
				 * html.light class toggle.  Do NOT replace with hardcoded hex here —
				 * that would break the light/dark theme.
				 *
				 * Opacity modifiers (bg-card/50) work via the -ch channel-triplet vars
				 * defined alongside each color in index.css.  --color-side keeps its
				 * built-in alpha so opacity modifiers on `side` ignore that base alpha.
				 */
				bg: 'rgb(var(--color-bg-ch) / <alpha-value>)',
				bg2: 'rgb(var(--color-bg2-ch) / <alpha-value>)',
				card: 'rgb(var(--color-card-ch) / <alpha-value>)',
				card2: 'rgb(var(--color-card2-ch) / <alpha-value>)',
				side: 'rgb(var(--color-side-ch) / <alpha-value>)',
				brd: 'rgb(var(--color-brd-ch) / <alpha-value>)',
				brd2: 'rgb(var(--color-brd2-ch) / <alpha-value>)',
				t1: 'rgb(var(--color-t1-ch) / <alpha-value>)',
				t2: 'rgb(var(--color-t2-ch) / <alpha-value>)',
				tm: 'rgb(var(--color-tm-ch) / <alpha-value>)',
				accent: 'rgb(var(--color-accent-ch) / <alpha-value>)',
				accent2: 'rgb(var(--color-accent2-ch) / <alpha-value>)',
				accent3: 'rgb(var(--color-accent3-ch) / <alpha-value>)',

				lighten: '#ffffff51',
				darken: '#00000051',
				nav: '#2E2B3B',

				/* ── Earth palette — tints (20–80) + base (DEFAULT) + shades (s20–s80) ── */
				rufous: {
					DEFAULT: '#A0361B',
					20: '#ECD7D1',
					40: '#D9AFA4',
					60: '#C68676',
					80: '#B35E49',
					s20: '#802B16',
					s40: '#602010',
					s60: '#40160B',
					s80: '#200B05',
				},
				sinopia: {
					DEFAULT: '#C4501B',
					20: '#F3DCD1',
					40: '#E7B9A4',
					60: '#DC9676',
					80: '#D07349',
					s20: '#9D4016',
					s40: '#763010',
					s60: '#4E200B',
					s80: '#271005',
				},
				carrot: {
					DEFAULT: '#E9972D',
					20: '#FBEAD5',
					40: '#F6D5AB',
					60: '#F2C181',
					80: '#EDAC57',
					s20: '#BA7924',
					s40: '#8C5B1B',
					s60: '#5D3C12',
					s80: '#2F1E09',
				},
				hunter: {
					DEFAULT: '#2B5B3F',
					20: '#D5DED9',
					40: '#AABDB2',
					60: '#809D8C',
					80: '#557C65',
					s20: '#224932',
					s40: '#1A3726',
					s60: '#112419',
					s80: '#09120D',
				},
				forest: {
					DEFAULT: '#143829',
					20: '#D0D7D4',
					40: '#A1AFA9',
					60: '#72887F',
					80: '#436054',
					s20: '#102D21',
					s40: '#0C2219',
					s60: '#081610',
					s80: '#040B08',
				},

				primary: 'var(--color-rufous)',

				secondary: '#86D8DF',
				'secondary-lt': '#D7F1F4',
				'secondary-dk': '#2CAEBA',
				'secondary-70': '#25939D',

				tertiary: {
					99: '#FFFBFF',
					95: '#FFEED8',
					90: '#FFDEA9',
					80: '#FEBE3F',
					70: '#DCA120',
					60: '#BD8700',
					50: '#9C6F00',
					40: '#7D5800',
					30: '#5E4100',
					20: '#422C00',
					10: '#271900',
				},

				airglow: {
					5: '#FBFEFE',
					10: '#EEFAFC',
					20: '#D6F2F5',
					30: '#BEEBEF',
					40: '#9ADDE5',
					50: '#72D1DA',
					60: '#36BDC9',
					70: '#25939D',
					80: '#1B767E',
					90: '#124954',
					95: '#0D373F',
				},

				neutral: {
					10: '#F8F9FA',
					20: '#EDEFF2',
					30: '#DEE1E6',
					40: '#CED3DA',
					50: '#AAB1BB',
					60: '#7E8690',
					70: '#515861',
					80: '#3E444C',
					90: '#252A32',
					95: '#14191F',
				},

				thomas: {
					1: '#63637E',
					2: '#495672',
					3: '#383330',
					4: '#04316c',
					5: '#B9C6D7',
					6: '#004986',
					7: '#1C1F35',
					8: '#666C89',
					9: '#667079',
					10: '#F8F9FB',
					red: '#A43F4A',
					blue: '#3C80D2',
					green: '#289B80',
				},

				ssc: {
					primarylight: '#00263a',
					light: '#c4ccd0',
					light2nd: '#d4e3ff',
					gold: '#febe3f',
					'gold-dk': '#dc9c1d',
					opd: '#00344d',
				},
			},
			containers: {
				lg: '20px',
			},
			screens: {
				'3xl': '1840px', // Custom breakpoint for 1920px / 1080p
				'4xl': '2460px', // Custom breakpoint for 2560px / 1440p
			},
		},
	},
	plugins: [
		'@tailwindcss/container-queries',
		plugin(({ addBase, theme }) => {
			const baseFs = theme('fontSize.base')
			const baseSize = Array.isArray(baseFs) ? baseFs[0] : baseFs
			const baseLh = Array.isArray(baseFs)
				? baseFs[1]?.lineHeight
				: undefined
			addBase({
				':root': {
					'--fs-body': baseSize,
					/* Bootstrap 5: body and .form-control etc. use this when Bootstrap CSS is loaded */
					'--bs-body-font-size': 'var(--fs-body)',
				},
				html: {
					color: theme('colors.neutral.95'),
				},
				body: {
					...(baseLh ? { lineHeight: baseLh } : {}),
					fontSize: baseSize,
				},
			})
		}),
	],
}
