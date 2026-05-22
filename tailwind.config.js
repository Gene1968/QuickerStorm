/** @type {import('tailwindcss').Config} */
import defaultTheme from "tailwindcss/defaultTheme";

import plugin from "tailwindcss/plugin";

export default {
	important: true, // Add !important to all Tailwind utilities to override Bootstrap
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
			 * Fluid type: clamp(min, vw blend, max). Rem units inside clamp resolve against the
			 * browser root (16px), not html — so they do not double-scale with the fluid html root.
			 */
			fontSize: {
				xs: [
					'clamp(0.75rem, 0.35vw + 0.65rem, 0.875rem)',
					{ lineHeight: '1rem' },
				],
				sm: [
					'clamp(0.8125rem, 0.4vw + 0.7rem, 0.9375rem)',
					{ lineHeight: '1.25rem' },
				],
				base: [
					'clamp(0.875rem, 0.45vw + 0.75rem, 1rem)',
					{ lineHeight: '1.5rem' },
				],
				lg: [
					'clamp(1rem, 0.55vw + 0.82rem, 1.125rem)',
					{ lineHeight: '1.75rem' },
				],
				xl: [
					'clamp(1.0625rem, 0.65vw + 0.85rem, 1.25rem)',
					{ lineHeight: '1.75rem' },
				],
				'2xl': [
					'clamp(1.125rem, 0.85vw + 0.9rem, 1.5rem)',
					{ lineHeight: '2rem' },
				],
				'3xl': [
					'clamp(1.375rem, 1.1vw + 1rem, 1.875rem)',
					{ lineHeight: '2.25rem' },
				],
				'4xl': [
					'clamp(1.5rem, 1.35vw + 1.05rem, 2.25rem)',
					{ lineHeight: '2.5rem' },
				],
				'5xl': [
					'clamp(1.75rem, 1.75vw + 1.1rem, 3rem)',
					{ lineHeight: '1' },
				],
				'6xl': [
					'clamp(2rem, 2.25vw + 1.2rem, 3.75rem)',
					{ lineHeight: '1' },
				],
				'7xl': [
					'clamp(2.25rem, 2.75vw + 1.25rem, 4.5rem)',
					{ lineHeight: '1' },
				],
				'8xl': [
					'clamp(2.75rem, 3.5vw + 1.5rem, 6rem)',
					{ lineHeight: '1' },
				],
				'9xl': [
					'clamp(3.25rem, 4.25vw + 1.75rem, 8rem)',
					{ lineHeight: '1' },
				],
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
				 * Opacity modifiers (bg-card/50) do NOT work with CSS-var colors;
				 * use inline style or a rgba() value directly if you need translucency.
				 */
				bg: 'var(--color-bg)',
				bg2: 'var(--color-bg2)',
				card: 'var(--color-card)',
				card2: 'var(--color-card2)',
				side: 'var(--color-side)',
				brd: 'var(--color-brd)',
				brd2: 'var(--color-brd2)',
				t1: 'var(--color-t1)',
				t2: 'var(--color-t2)',
				tm: 'var(--color-tm)',
				accent: 'var(--color-accent)',
				accent2: 'var(--color-accent2)',
				accent3: 'var(--color-accent3)',

				lighten: '#ffffff51',
				darken: '#00000051',
				nav: '#2E2B3B',

				primary: '#1B4F98',
				'primary-5': '#F6FAFD',
				'primary-10': '#EAF3FA',
				'primary-20': '#DCECFA',
				'primary-30': '#B4D6F4',
				'primary-40': '#91C2ED',
				'primary-50': '#509EEC',
				'primary-60': '#297EE0',
				'primary-70': '#1F63B7',
				'primary-80': '#1B4F98',
				'primary-90': '#0F2D57',
				'primary-95': '#0B2241',

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
