/** @type {import('tailwindcss').Config} */
import defaultTheme from "tailwindcss/defaultTheme";

import plugin from "tailwindcss/plugin";

export default {
	// important: true, // Add !important to all Tailwind utilities to override Bootstrap
	content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
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
				orbitron: ['Orbitron', ...defaultTheme.fontFamily.sans],
				nunito: ['Nunito', ...defaultTheme.fontFamily.sans],
				serif: ['Besley', ...defaultTheme.fontFamily.serif],
				sans: ['Nunito', ...defaultTheme.fontFamily.sans],
				firacode: ['FiraCode', ...defaultTheme.fontFamily.mono],
				mono: ['FiraCode', ...defaultTheme.fontFamily.mono],
				display: [
					'Orbitron',
					...defaultTheme.fontFamily.serif,
				],
			},
			colors: {
				/*
				 * Semantic tokens — contrast-aware, auto-flip with html.light
				 * Opacity modifiers work (bg-panel/50) via -ch channel-triplet vars.
				 */
				surface:        'rgb(var(--surface-ch) / <alpha-value>)',
				panel:          'rgb(var(--panel-ch) / <alpha-value>)',
				'panel-alt':    'rgb(var(--panel-alt-ch) / <alpha-value>)',
				sidebar:        'rgb(var(--sidebar-ch) / <alpha-value>)',
				edge:           'rgb(var(--edge-ch) / <alpha-value>)',
				'edge-strong':  'rgb(var(--edge-strong-ch) / <alpha-value>)',
				fg:             'rgb(var(--fg-ch) / <alpha-value>)',
				'fg-subtle':    'rgb(var(--fg-subtle-ch) / <alpha-value>)',
				'fg-muted':     'rgb(var(--fg-muted-ch) / <alpha-value>)',
				accent:         'rgb(var(--accent-ch) / <alpha-value>)',
				'accent-dark':  'rgb(var(--accent-dark-ch) / <alpha-value>)',
				'accent-light': 'rgb(var(--accent-light-ch) / <alpha-value>)',

				/* non-semantic — kept for direct usage */
				lighten: '#ffffff51',
				darken:  '#00000051',
				nav:     '#2E2B3B',
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
