/**
 * officeLayout.js
 * Defines the quickerSTORM virtual world plan, camera positions, and spatial connections.
 *
 * Coordinate system (Three.js): X = right, Y = up, Z = toward viewer.
 * All room positions are [x, z] world-space centers.
 * Heights are in Y (meters, roughly 1 unit = 1 m).
 *
 * X columns (no overlap):
 *   Left  — Conference + Gym:   x ≈ -28  (X range -40 → -16)
 *   Center — Lobby + Main Hall: x = 0
 *   Right  — Meetings + Break + Office Wing + Offices: x > -12
 *
 * ── Door fields ────────────────────────────────────────────────────────
 *   wall        — Which room wall the 3D door cutout/mesh is rendered on.
 *                 Controls visual geometry. DO NOT CHANGE — moving this
 *                 moves the visible door opening and breaks the scene.
 *
 *   triggerSide — (optional) Which wall the WASD walk-trigger fires on.
 *                 Omit when it should match `wall`. Set when the intuitive
 *                 walking direction (toward the connected room) differs from
 *                 where the visual door was placed. e.g. in main-hall the
 *                 meeting-room cutouts are on the south wall but the rooms
 *                 are to the north, so triggerSide:"north" lets you walk
 *                 north to enter them.
 *
 *   toRoom      — Destination room ID for WASD door detection. Read-only
 *                 navigation metadata; has no effect on visuals.
 */

// WHY: createLobbySunkenLounge.js removed from repo; stub until officeLayout is eliminated
const LOBBY_SUNKEN_SEAT_RING = { rx: 0, rz: 0 }

/** Elliptical ring seats facing (cx, cz) — west lobby sunken lounge. */
function lobbyPitSeatRing ({ cx, cz, rx, rz, count, startIndex }) {
	const seats = []
	for (let i = 0; i < count; i++) {
		const t = (i / count) * Math.PI * 2 - Math.PI / 2
		seats.push({
			seatId: `lobby:${startIndex + i}`,
			pos: [cx + rx * Math.cos(t), 0, cz + rz * Math.sin(t)],
			focal: [cx, 1.0, cz],
			sitYOffset: -0.45,
		})
	}
	return seats
}

// ── Core rooms ─────────────────────────────────────────────────────
export const ROOMS = [
	{
		id: 'lobby',
		name: 'Lobby',
		type: 'lobby',
		icon: '🏢',
		pos: [-18, 0],
		size: [44, 28],
		// Tall walls + gabled greenhouse glass roof + sky sphere (`useOfficeEngine`).
		height: 8.2,
		ceilingKind: 'glass-greenhouse',
		roofRise: 4.8,
		description: 'Main entrance and reception',
		camPos: [-18, 1.8, 10],
		camTarget: [-18, 1.6, -4],
		connections: ['main-hall'],
		doors: [
			{
				wall: 'south',
				offset: 0,
				width: 4.5,
				label: 'To Offices',
				toRoom: 'office-hall',
			},
			{
				wall: 'north',
				offset: 0,
				width: 3.5,
				label: 'To Offices',
				toRoom: 'main-hall',
			},
		],
		furniture: [
			{ type: 'desk-reception', pos: [0, 0, -5], rot: 0 },
			// Two sofa pairs clustered on the east side (~square conversation block)
			{ type: 'sofa', pos: [10, 0, 5], rot: 0 },
			{ type: 'sofa', pos: [10, 0, 10], rot: Math.PI },
			{ type: 'coffee-table', pos: [10, 0, 7.5] },
			{ type: 'sofa', pos: [14, 0, 5], rot: 0 },
			{ type: 'sofa', pos: [14, 0, 10], rot: Math.PI },
			{ type: 'coffee-table', pos: [14, 0, 7.5] },
			// West — sunken pit + continuous curved couch (torus) + glass fire feature
			{
				type: 'lobby-sunken-lounge',
				pos: [-14, 0, 0],
				ringRx: LOBBY_SUNKEN_SEAT_RING.rx,
				ringRz: LOBBY_SUNKEN_SEAT_RING.rz,
			},
			{ type: 'plant', pos: [-19, 0, -11] },
			{ type: 'plant', pos: [19, 0, -11] },
			{ type: 'plant', pos: [-19, 0, 11] },
			{ type: 'plant', pos: [19, 0, 11] },
			{ type: 'sign', pos: [0, 3.33, -13.5], text: 'quickerSTORM' },
			{
				type: 'magazine',
				pos: [10, 0.41, 7.5],
				url: 'https://laspaceforce.com',
			},
			{
				type: 'magazine',
				pos: [14, 0.41, 7.5],
				url: 'https://laspaceforce.com',
			},
			// Mondrian painting on south wall above sofa cluster
			{ type: 'painting-mondrian', pos: [12, 1.65, 13.85], rot: Math.PI },
			// Large floor-to-ceiling aquarium on the east wall
			{ type: 'aquarium', pos: [21.55, 0, 0] },
			// Lava-lamp wall on the west wall (opposite the aquarium)
			{ type: 'lava-lamp-wall', pos: [-21.55, 0, 0] },
			// Deli-style ticket queue — dispenser on reception desk, sign on north wall
			{ type: 'ticket-dispenser', pos: [1.8, 0.78, -4.8], rot: 0 },
			{ type: 'now-serving-sign', pos: [5, 0, -13.9], rot: 0 },
		],
		seats: [
			// Inner pair (moved from west) — x ≈ 10
			{ seatId: 'lobby:0', pos: [9.4, 0, 5.11], focal: [10, 1.0, 10] },
			{ seatId: 'lobby:1', pos: [10.6, 0, 5.11], focal: [10, 1.0, 10] },
			{ seatId: 'lobby:2', pos: [9.4, 0, 9.89], focal: [10, 1.0, 5] },
			{ seatId: 'lobby:3', pos: [10.6, 0, 9.89], focal: [10, 1.0, 5] },
			// East pair — x ≈ 14
			{ seatId: 'lobby:4', pos: [13.4, 0, 5.11], focal: [14, 1.0, 10] },
			{ seatId: 'lobby:5', pos: [14.6, 0, 5.11], focal: [14, 1.0, 10] },
			{ seatId: 'lobby:6', pos: [13.4, 0, 9.89], focal: [14, 1.0, 5] },
			{ seatId: 'lobby:7', pos: [14.6, 0, 9.89], focal: [14, 1.0, 5] },
			// West sunken lounge — 25 ring seats on cushion centerline (matches torus scale)
			...lobbyPitSeatRing({
				cx: -14,
				cz: 0,
				rx: LOBBY_SUNKEN_SEAT_RING.rx - 0.2,
				rz: LOBBY_SUNKEN_SEAT_RING.rz - 0.25,
				count: 25,
				startIndex: 8,
			}),
		],
		floorType: 'marble',
	},

	{
		id: 'main-hall',
		name: 'Main Hallway',
		type: 'corridor',
		icon: '🚶',
		pos: [2, -19],
		size: [84, 10],
		height: 3.2,
		description: 'Central corridor connecting all areas',
		camPos: [0, 1.8, -16],
		camTarget: [0, 1.6, -24],
		connections: [
			'lobby',
			'conference',
			'meeting-a',
			'meeting-b',
			'break-room',
			'storage',
			'office-hall',
			'courtyard',
		],
		doors: [
			{
				wall: 'north', // visual cutout on north wall
				triggerSide: 'south', // lobby is south — walk south to enter
				offset: -20,
				width: 3.5,
				label: 'Lobby',
				labelY: 0.3,
				toRoom: 'lobby',
			},
			{
				wall: 'south', // visual cutout on south wall
				triggerSide: 'north', // conference is north — walk north to enter
				offset: -30,
				width: 3,
				label: 'Conference',
				labelY: 3.5,
				toRoom: 'conference',
			},
			{
				wall: 'south', // visual cutout on south wall
				triggerSide: 'north', // meeting rooms are north — walk north to enter
				offset: -12,
				width: 2.8,
				label: 'Mtg A',
				labelY: 2.0,
				toRoom: 'meeting-a',
			},
			{
				wall: 'south', // visual cutout on south wall
				triggerSide: 'north', // meeting rooms are north — walk north to enter
				offset: 0,
				width: 2.8,
				label: 'Mtg B',
				labelY: 2.8,
				toRoom: 'meeting-b',
			},
			{
				wall: 'south', // visual cutout on south wall
				triggerSide: 'north', // break room is north — walk north to enter
				offset: 18,
				width: 3,
				label: 'Break Room',
				labelY: 3.5,
				toRoom: 'break-room',
			},
			{
				wall: 'south', // visual cutout on south wall
				triggerSide: 'north', // storage is north — walk north to enter
				offset: 36,
				width: 2.5,
				label: 'Storage',
				labelY: 3.5,
				toRoom: 'storage',
			},
			{
				wall: 'north', // visual cutout on north wall (shared boundary with courtyard south)
				triggerSide: 'south', // courtyard is south — walk south to enter
				offset: 22,
				width: 3,
				label: 'Courtyard',
				labelY: 0.3,
				toRoom: 'courtyard',
			},
		],
		furniture: [
			{ type: 'fern', pos: [-40, 0, 3] },
			{ type: 'fern', pos: [40, 0, 3] },
			{ type: 'suggestion-box', pos: [14.75, -0.44, -4.75], rot: 0 },
		],
		floorType: 'tile',
	},

	{
		id: 'conference',
		name: 'Conference Room',
		type: 'conference',
		icon: '📋',
		// X col: -28 (range -40 → -16, west wall aligns with main-hall west at X=-40)
		pos: [-28, -32],
		size: [24, 16],
		height: 3.2,
		description: 'Main conference room — seats up to 20',
		camPos: [-28, 1.8, -26],
		camTarget: [-28, 1.6, -32],
		connections: ['main-hall'],
		doors: [
			{
				wall: 'north',
				triggerSide: 'south', // main-hall is south — walk south to exit
				offset: 0,
				width: 3,
				label: 'Hallway',
				labelY: 5.6,
				toRoom: 'main-hall',
			},
		],
		furniture: [
			{ type: 'conference-table', pos: [0, 0, 0] },
			// South wall (opposite the north / door wall), centered — face into room (default +Z).
			// Y lowered so the 2× world-clock clears the 3.2 m ceiling.
			{ type: 'world-clock', pos: [0, 1.72, -(16 / 2 - 0.1)], rot: 0 },
			{ type: 'projector-screen', pos: [-11.5, 0, 0], rot: Math.PI / 2 },
			{ type: 'whiteboard', pos: [11, 0, -4], rot: -Math.PI / 2 },
			{ type: 'fern', pos: [10, 0, -7] },
			{ type: 'fern', pos: [10, 0, 7] },
			{ type: 'intercom', pos: [4, 1.2, -7.8] },
		],
		floorType: 'carpet',
		wallType: 'glass',
		focalPoint: [0, 1.0, 0],
		seats: [
			// Front long side (z = -1.5)
			{ seatId: 'conference:0', pos: [-4.2, 0, -1.5] },
			{ seatId: 'conference:1', pos: [-3.0, 0, -1.5] },
			{ seatId: 'conference:2', pos: [-1.8, 0, -1.5] },
			{ seatId: 'conference:3', pos: [-0.6, 0, -1.5] },
			{ seatId: 'conference:4', pos: [0.6, 0, -1.5] },
			{ seatId: 'conference:5', pos: [1.8, 0, -1.5] },
			{ seatId: 'conference:6', pos: [3.0, 0, -1.5] },
			{ seatId: 'conference:7', pos: [4.2, 0, -1.5] },
			// Back long side (z = +1.5)
			{ seatId: 'conference:8', pos: [-4.2, 0, 1.5] },
			{ seatId: 'conference:9', pos: [-3.0, 0, 1.5] },
			{ seatId: 'conference:10', pos: [-1.8, 0, 1.5] },
			{ seatId: 'conference:11', pos: [-0.6, 0, 1.5] },
			{ seatId: 'conference:12', pos: [0.6, 0, 1.5] },
			{ seatId: 'conference:13', pos: [1.8, 0, 1.5] },
			{ seatId: 'conference:14', pos: [3.0, 0, 1.5] },
			{ seatId: 'conference:15', pos: [4.2, 0, 1.5] },
			// Left short end (x = -5.5)
			{ seatId: 'conference:16', pos: [-5.5, 0, -0.6] },
			{ seatId: 'conference:17', pos: [-5.5, 0, 0.6] },
			// Right short end (x = +5.5)
			{ seatId: 'conference:18', pos: [5.5, 0, -0.6] },
			{ seatId: 'conference:19', pos: [5.5, 0, 0.6] },
		],
	},

	{
		id: 'meeting-a',
		name: 'Meeting Room A',
		type: 'meeting',
		icon: '💬',
		pos: [-10, -32],
		size: [12, 16],
		height: 3.2,
		description: 'Small meeting room — seats 4–6',
		camPos: [-10, 1.8, -26],
		camTarget: [-10, 1.6, -32],
		connections: ['main-hall'],
		doors: [
			{
				wall: 'north',
				triggerSide: 'south', // main-hall is south — walk south to exit
				offset: 0,
				width: 2.5,
				label: 'Hallway',
				labelY: 5.6,
				toRoom: 'main-hall',
			},
		],
		furniture: [
			{ type: 'round-table', pos: [0, 0, 0] },
			{ type: 'whiteboard', pos: [0, 0, -5.5], rot: 0 },
			{ type: 'plant', pos: [-4.5, 0, 4.5] },
			{ type: 'wall-clock', pos: [5.85, 0, 2], rot: -Math.PI / 2 },
		],
		floorType: 'carpet',
		wallType: 'glass',
		focalPoint: [0, 1.0, 0],
		seats: [
			{ seatId: 'meeting-a:0', pos: [0, 0, 1.25] },
			{ seatId: 'meeting-a:1', pos: [1.25, 0, 0] },
			{ seatId: 'meeting-a:2', pos: [0, 0, -1.25] },
			{ seatId: 'meeting-a:3', pos: [-1.25, 0, 0] },
		],
	},

	{
		id: 'meeting-b',
		name: 'Meeting Room B',
		type: 'meeting',
		icon: '💬',
		pos: [2, -32],
		size: [12, 16],
		height: 3.2,
		description: 'Small meeting room — seats 4–6',
		camPos: [2, 1.8, -26],
		camTarget: [2, 1.6, -32],
		connections: ['main-hall'],
		doors: [
			{
				wall: 'north',
				triggerSide: 'south', // main-hall is south — walk south to exit
				offset: 0,
				width: 2.5,
				label: 'Hallway',
				labelY: 5.6,
				toRoom: 'main-hall',
			},
		],
		furniture: [
			{ type: 'round-table', pos: [0, 0, 0] },
			{ type: 'whiteboard', pos: [0, 0, -5.5], rot: 0 },
			{ type: 'plant', pos: [4.5, 0, 4.5] },
			{ type: 'wall-clock', pos: [-5.85, 0, 2], rot: Math.PI / 2 },
		],
		floorType: 'carpet',
		wallType: 'glass',
		focalPoint: [0, 1.0, 0],
		seats: [
			{ seatId: 'meeting-b:0', pos: [0, 0, 1.25] },
			{ seatId: 'meeting-b:1', pos: [1.25, 0, 0] },
			{ seatId: 'meeting-b:2', pos: [0, 0, -1.25] },
			{ seatId: 'meeting-b:3', pos: [-1.25, 0, 0] },
		],
	},

	{
		id: 'break-room',
		name: 'Break Room',
		type: 'breakroom',
		icon: '☕',
		pos: [20, -32],
		size: [24, 16],
		height: 3.2,
		description: 'Break room — water cooler, coffee, snacks',
		camPos: [17, 1.8, -26],
		camTarget: [17, 1.6, -32],
		connections: ['main-hall'],
		doors: [
			{
				wall: 'north',
				triggerSide: 'south', // main-hall is south — walk south to exit
				offset: 0,
				width: 3,
				label: 'Hallway',
				labelY: 5.6,
				toRoom: 'main-hall',
			},
		],
		furniture: [
			{ type: 'plant', pos: [-10.5, 0, 6.5] },
			{ type: 'wall-clock', pos: [-11.82, 0.25, 0.0], rot: Math.PI / 2 },
			{
				type: 'connect4-cabinet',
				pos: [-11.3, 0, -2.0],
				rot: Math.PI / 2,
			},
			{ type: 'arcade', pos: [-11.3, 0, -3.5], rot: Math.PI / 2 },
			{ type: 'arcade-pacman', pos: [-11.3, 0, -5.0], rot: Math.PI / 2 },
			{ type: 'kudos-plaque', pos: [-7, 0, -7.8], rot: 0 },
			{ type: 'refrigerator', pos: [-4.5, 1.4, -7], rot: -Math.PI / 2 },
			{ type: 'counter', pos: [0, 0, -6] },
			{ type: 'wall-sign', pos: [7, 0, -7.8], text: 'Inada Kona Coffee' },
			{ type: 'coffee-machine', pos: [7, 0, -6.5] },
			{ type: 'water-cooler', pos: [9, 0, -6.5] },
			{ type: 'tv', pos: [11.7, -0.25, 0], rot: -Math.PI / 2 },
			{ type: 'fern', pos: [10.5, 0, 6.5] },
			{ type: 'trashcan', pos: [4, 0.425, 7.25], rot: -Math.PI / 2 },
			{ type: 'recycling-bin', pos: [2.75, 0.645, 7.25] },
			{ type: 'round-table', pos: [-4, 0, 2.75] },
			{ type: 'round-table', pos: [4, 0, 2.75] },
		],
		floorType: 'tile',
		seats: [
			{ seatId: 'break-room:0', pos: [-4, 0, 4], focal: [-4, 1.0, 2.75] },
			{
				seatId: 'break-room:1',
				pos: [-2.75, 0, 2.75],
				focal: [-4, 1.0, 2.75],
			},
			{
				seatId: 'break-room:2',
				pos: [-4, 0, 1.5],
				focal: [-4, 1.0, 2.75],
			},
			{
				seatId: 'break-room:3',
				pos: [-5.25, 0, 2.75],
				focal: [-4, 1.0, 2.75],
			},
			{ seatId: 'break-room:4', pos: [4, 0, 4], focal: [4, 1.0, 2.75] },
			{
				seatId: 'break-room:5',
				pos: [5.25, 0, 2.75],
				focal: [4, 1.0, 2.75],
			},
			{ seatId: 'break-room:6', pos: [4, 0, 1.5], focal: [4, 1.0, 2.75] },
			{
				seatId: 'break-room:7',
				pos: [2.75, 0, 2.75],
				focal: [4, 1.0, 2.75],
			},
		],
	},

	{
		id: 'courtyard',
		name: 'Courtyard',
		type: 'courtyard',
		icon: '🌿',
		pos: [24, 0],
		size: [40, 28],
		height: 5,
		ceilingKind: 'none',
		description: 'Outdoor courtyard — fresh air, grass, and a fountain',
		camPos: [24, 4, 6],
		camTarget: [24, 0.8, 0],
		connections: ['main-hall'],
		doors: [
			{
				wall: 'south',
				triggerSide: 'north',
				offset: 0,
				width: 3,
				label: 'Hallway',
				labelY: 5.6,
				toRoom: 'main-hall',
			},
		],
		furniture: [
			// Central fountain
			{ type: 'fountain', pos: [0, 1.8, 0] },
			// Sidewalk cross — N/S path + E/W path
			{ type: 'sidewalk', pos: [-13, 0, 0], rot: 0 },
			{ type: 'sidewalk', pos: [0, -0.005, -2.5], rot: 0 },
			{ type: 'sidewalk', pos: [13, 0, 0], rot: 0 },
			{ type: 'sidewalk', pos: [0, 0, -10], rot: Math.PI / 2 },
			{ type: 'sidewalk', pos: [0, 0, 0], rot: Math.PI / 2 },
			{ type: 'sidewalk', pos: [0, 0, 10], rot: Math.PI / 2 },
			// Corner trees
			{ type: 'tree-jacaranda', pos: [-16, 3.6, -9] },
			{ type: 'tree-jacaranda', pos: [16, 3.6, -9] },
			{ type: 'tree-jacaranda', pos: [-16, 3.6, 9] },
			{ type: 'tree-jacaranda', pos: [16, 3.6, 9] },
			// Hedges — E/W edges
			{ type: 'hedge', pos: [-18, 1, 0] },
			{ type: 'hedge', pos: [18, 1, 0] },
			// Hedges — N edge
			{ type: 'hedge', pos: [-8, 1, -12.5], rot: Math.PI / 2 },
			{ type: 'hedge', pos: [8, 1, -12.5], rot: Math.PI / 2 },
			// Hedges — S edge
			{ type: 'hedge', pos: [-8, 1, 12.5], rot: Math.PI / 2 },
			{ type: 'hedge', pos: [8, 1, 12.5], rot: Math.PI / 2 },
			// Benches facing the fountain
			{ type: 'park-bench', pos: [0, 0.275, -5.5], rot: 0 },
			{ type: 'park-bench', pos: [0, 0.275, 5.5], rot: Math.PI },
			{ type: 'park-bench', pos: [-5.5, 0.275, 0], rot: Math.PI / 2 },
			{ type: 'park-bench', pos: [5.5, 0.275, 0], rot: -Math.PI / 2 },
		],
		floorType: 'grass',
		seats: [
			// Bench 1 — south of fountain, facing fountain (+Z)
			{
				seatId: 'courtyard:0',
				pos: [-0.45, 0, -5.5],
				focal: [0, 1.0, 0],
			},
			{ seatId: 'courtyard:1', pos: [0.45, 0, -5.5], focal: [0, 1.0, 0] },
			// Bench 2 — north of fountain, facing fountain (-Z)
			{ seatId: 'courtyard:2', pos: [-0.45, 0, 5.5], focal: [0, 1.0, 0] },
			{ seatId: 'courtyard:3', pos: [0.45, 0, 5.5], focal: [0, 1.0, 0] },
			// Bench 3 — west of fountain, facing fountain (+X)
			{
				seatId: 'courtyard:4',
				pos: [-5.5, 0, -0.45],
				focal: [0, 1.0, 0],
			},
			{ seatId: 'courtyard:5', pos: [-5.5, 0, 0.45], focal: [0, 1.0, 0] },
			// Bench 4 — east of fountain, facing fountain (-X)
			{ seatId: 'courtyard:6', pos: [5.5, 0, -0.45], focal: [0, 1.0, 0] },
			{ seatId: 'courtyard:7', pos: [5.5, 0, 0.45], focal: [0, 1.0, 0] },
		],
	},

	{
		id: 'storage',
		name: 'Storage Room',
		type: 'utility',
		icon: '📦',
		// X range 26 → 38, west wall flush with break-room east wall; east of hallway extended to X=40
		pos: [38, -32],
		size: [12, 16],
		height: 3.2,
		description: 'Storage and supplies',
		camPos: [32, 1.8, -26],
		camTarget: [32, 1.6, -32],
		connections: ['main-hall'],
		doors: [
			{
				wall: 'north',
				triggerSide: 'south', // main-hall is south — walk south to exit
				offset: 0,
				width: 2.5,
				label: 'Hallway',
				labelY: 5.6,
				toRoom: 'main-hall',
			},
		],
		furniture: [
			{ type: 'bookshelf', pos: [-4, 0, -7.5], rot: 0 },
			{ type: 'bookshelf', pos: [0, 0, -7.5], rot: 0 },
			{ type: 'bookshelf', pos: [4, 0, -7.5], rot: 0 },
			{ type: 'bookshelf', pos: [-5.5, 0, 2], rot: Math.PI / 2 },
			{ type: 'bookshelf', pos: [-5.5, 0, -3], rot: Math.PI / 2 },
			{ type: 'plant', pos: [4.5, 0, 6.5] },
			{
				type: 'wall-sign',
				pos: [5.85, 0.75, -5.5],
				rot: -Math.PI / 2,
				text: 'Tyndalltron v0.99a (2025)',
			},
			{ type: 'vector-robot', pos: [4.5, 1, -5.5], rot: -Math.PI / 2 },
			{ type: 'solar-panel', pos: [4, 0, 0], rot: -Math.PI / 2 },
			{ type: 'solar-panel', pos: [4, 0, 3], rot: -Math.PI / 2 },
		],
		floorType: 'tile',
	},

	{
		id: 'gym',
		name: 'Gym',
		type: 'gym',
		icon: '🏋️',
		// West wall (X=-40) aligned with conference/main-hall. East wall (X=-16) touches office-hall west.
		// Gym X range -40 → -16, Office Wing X range -16 → 44: flush ✓
		pos: [-28, -52],
		size: [24, 23.5],
		height: 4.5,
		description: 'Company gym — treadmills, weights, mats',
		camPos: [-28, 1.8, -43],
		camTarget: [-28, 1.6, -52],
		connections: ['office-hall'],
		doors: [
			{
				wall: 'east',
				triggerSide: 'west', // office-hall is west — walk west to exit
				offset: 0,
				width: 3,
				label: 'Office Wing',
				toRoom: 'office-hall',
			},
		],
		furniture: [
			{ type: 'treadmill', pos: [-6, 0, -4] },
			{ type: 'treadmill', pos: [-1, 0, -4] },
			{ type: 'treadmill', pos: [4, 0, -4] },
			{ type: 'weights', pos: [-6, 0, 4] },
			{ type: 'weights', pos: [0, 0, 4] },
			{ type: 'mat', pos: [6, 0, 5] },
			{ type: 'mat', pos: [6, 0, 1] },
			{ type: 'plant', pos: [-9.5, 0, 9.5] },
			{ type: 'plant', pos: [9.5, 0, 9.5] },
		],
		floorType: 'rubber',
	},

	{
		id: 'office-hall',
		name: 'Office Wing',
		type: 'corridor',
		icon: '🚪',
		// Same Z as gym. West wall (X=-16) flush with gym east wall — shared boundary ✓
		// X range -16 → 44, Gym X range -40 → -16: flush ✓
		pos: [14, -52],
		size: [60, 10],
		height: 3.2,
		description: 'Individual offices corridor',
		camPos: [14, 2.5, -55],
		camTarget: [14, 1.6, -48],
		connections: ['main-hall', 'gym'],
		doors: [
			{
				wall: 'north',
				triggerSide: 'south', // main-hall is south — walk south to exit
				offset: 0,
				width: 3.5,
				label: 'Main Hall',
				labelY: 4.8,
				toRoom: 'main-hall',
			},
			{
				wall: 'west',
				triggerSide: 'east', // gym is east — walk east to enter
				offset: 0,
				width: 3,
				label: 'Gym',
				toRoom: 'gym',
			},
		],
		// North and south walls are fully covered by individual office walls (which
		// have their own door gaps). Skipping them prevents double-wall overlap that
		// makes office doorways look like solid grey panels.
		skipWalls: ['north', 'south'],
		furniture: [
			{ type: 'fern', pos: [-20, 0, 0] },
			{ type: 'fern', pos: [0, 0, 0] },
			{ type: 'fern', pos: [20, 0, 0] },
		],
		floorType: 'carpet',
	},
]

// ── Individual offices ─────────────────────────────────────────────
function generateOffices(count = 16) {
	const offices = []
	// Two rows flanking the office-hall corridor
	// Hall: pos [14, -52], size [60, 10] → half-depth = 5
	// North row: -52 - 5 - 3.5 = -60.5
	// South row: -52 + 5 + 3.5 = -43.5  (south offices south edge = -40 = conf/mtg north)
	// 8 offices per row × 7.5 wide = 60, centred on hall x=14
	// startX = 14 - 30 + 3.75 = -12.25
	const officeW = 7.5
	const officeD = 7
	const northZ  = -60.5
	const southZ  = -43.5
	const startX  = -12.25
	// const perRow  = Math.ceil(count / 2)

	for (let i = 0; i < count; i++) {
		// Alternate corridor sides: even i → north row, odd i → south row (office id = i + 1,
		// so **odd-numbered** offices 1,3,5… are north-facing / door on north wall; **even** 2,4,6… south).
		const row = i % 2 === 0 ? 'north' : 'south'
		const col = Math.floor(i / 2)
		const x   = startX + col * officeW
		const z   = row === 'north' ? northZ : southZ

		offices.push({
			id: `office-${i + 1}`,
			name: `Office ${i + 1}`,
			type: 'office',
			icon: '🏠',
			pos: [x, z],
			size: [officeW - 0.3, officeD],
			height: 3.2,
			description: 'Individual office',
			// Own-office camera: elevated behind chair, looking over head toward desk+door
			camPos:    [x, 2.2, z + (row === 'north' ? -2.2 :  2.2)],
			camTarget: [x, 1.0, z + (row === 'north' ?  2.0 : -2.0)],
			// Visitor camera: pulled back past the doorway to frame both avatars
			visitCamPos:    [x, 2.2, z + (row === 'north' ?  3.5 : -3.5)],
			visitCamTarget: [x, 1.3, z + (row === 'north' ? -0.5 :  0.5)],
			connections: ['office-hall'],
			doors: [
				{
					wall:        row === 'north' ? 'north' : 'south',
					triggerSide: row === 'north' ? 'south' : 'north', // office-hall is south of north row, north of south row
					offset: 0,
					width:  2.0,
					label:  '',
					labelY: 5.6,
					toRoom: 'office-hall',
				},
			],
			furniture: [
				// Desk on the door side; chair/monitor/bookshelf flip z by row so both orientations match
				{ type: 'desk',         pos: [0, 0,      row === 'north' ?  0.5  : -0.5 ], rot: row === 'north' ? Math.PI : 0 },
				{ type: 'monitor',      pos: [row === 'north' ? -0.75 : 0.75, 0.65, row === 'north' ? 0.75 : -0.75], rot: Math.PI * 0.82 },
				{ type: 'chair-office', pos: [0, 0,      row === 'north' ? -0.55 :  0.55], rot: row === 'north' ? 0 : Math.PI },
				{ type: 'bookshelf',    pos: [officeW / 2 - 0.8, 0, row === 'north' ? 1.0 : -1.0], rot: Math.PI / 2 },
				// Calendar screen — door wall, right of door when facing it from inside
				{
					type: 'office-wall-screen',
					pos: [
						row === 'north' ? -2.4 :  2.4,
						0,
						row === 'north' ?  (officeD / 2 - 0.06) : -(officeD / 2 - 0.06),
					],
					rot: row === 'north' ? Math.PI : 0,
				},
				// Above doorway (center x) — visible from desk / chair; same wall depth as wall-screen
				{
					type: 'wall-clock',
					pos: [
						0,
						0,
						row === 'north' ? officeD / 2 - 0.06 : -(officeD / 2 - 0.06),
					],
					rot: row === 'north' ? Math.PI : 0,
					mountY: 2.75,
					radius: 0.36,
				},
			],
			floorType: 'carpet',
			wallType:  'glass',
			userId:          null,
			userName:        null,
			userTitle:       null,
			userStatus:      'offline',
			userAvatarColor: null,
			row,
		})
	}
	return offices
}

export const OFFICES = generateOffices(16)

// Wire WASD entry from office-hall into each individual office.
// office-hall skips rendering its north/south walls (skipWalls), so these
// door entries only affect trigger detection — no visual geometry impact.
const _officeHall = ROOMS.find(r => r.id === 'office-hall')
for (const office of OFFICES) {
	_officeHall.doors.push({
		wall:        office.row === 'north' ? 'north' : 'south',
		triggerSide: office.row === 'north' ? 'north' : 'south',
		offset:      office.pos[0] - _officeHall.pos[0],
		width:       2.0,
		toRoom:      office.id,
	})
}

// ── Combined ───────────────────────────────────────────────────────
export const ALL_ROOMS = [...ROOMS, ...OFFICES]

// ── Helpers ────────────────────────────────────────────────────────
export function getRoomById(id) {
	return ALL_ROOMS.find(r => r.id === id) || null
}

export function getRoomsByType(type) {
	return ALL_ROOMS.filter(r => r.type === type)
}

/** World-space bounds of the entire floor plan (for floorplan SVG scaling) */
export const FLOOR_BOUNDS = {
	minX: -42,
	maxX:  52,
	minZ:  -73,
	maxZ:   19,
	get width()  { return this.maxX - this.minX },
	get depth()  { return this.maxZ - this.minZ },
}

/** Quick-access room IDs for sidebar buttons */
export const QUICK_NAV = [
	{ id: 'lobby',      label: 'Lobby',            icon: '🏢' },
	{ id: 'conference', label: 'Conference Room',  icon: '📋' },
	{ id: 'meeting-a',  label: 'Meeting Room A',   icon: '💬' },
	{ id: 'meeting-b',  label: 'Meeting Room B',   icon: '💬' },
	{ id: 'break-room', label: 'Break Room',       icon: '☕' },
	{ id: 'storage',    label: 'Storage Room',     icon: '📦' },
	{ id: 'gym',        label: 'Gym',              icon: '🏋️' },
	{ id: 'courtyard',  label: 'Courtyard',        icon: '🌿' },
]
