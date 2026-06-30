// src/lib/primMesher.js — faithful JS port of OpenSim's PrimMesher (Dahlia Trimble), the
// data-driven prim tessellator that turns SL shape parameters into geometry. Reference:
//   ../opensim/OpenSim/Region/PhysicsModules/Meshing/Meshmerizer/PrimMesher.cs  (Profile/Path/PrimMesh)
//   ../opensim/.../Meshmerizer/Meshmerizer.cs:754  (GenerateCoordsAndFacesFromPrimShapeData — the PBS→PrimMesh mapping)
//
// This replaces the old Three.js-primitive stand-ins (box/cylinder/sphere/torus) so hollow,
// profile cut, path cut, hole size, twist, taper, top shear, radius offset, revolutions and skew
// all render correctly. Output is an SL-space triangle soup (3 verts × 9 floats per triangle):
//   { positions:Float32Array, normals:Float32Array, uvs:Float32Array, faceNumbers:Int32Array }
// The world engine converts SL→Three and bakes prim scale (see primGeometry.js).
//
// PORT NOTE: C# Coord/Quat/Face/ViewerFace are value-type structs; List<struct> indexing returns
// a COPY. JS objects are references, so every place the C# relied on copy-on-read is cloned here
// (Profile.Copy deep-clones coords/normals/uvs; vertex normals are inverted into fresh Coords).

const twoPi = 2.0 * Math.PI
const twoPiInv = 1.0 / twoPi

// ---- Coord (Vector3) helpers -------------------------------------------------
function coord(x = 0, y = 0, z = 0) { return { x, y, z } }
function cClone(c) { return { x: c.x, y: c.y, z: c.z } }
function cLen(c) { return Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z) }
function cNorm(c) {
	const mag = cLen(c)
	if (mag > 1e-7) { const o = 1 / mag; c.x *= o; c.y *= o; c.z *= o }
	else { c.x = 0; c.y = 0; c.z = 0 }
	return c
}
function cNormed(c) { return cNorm(cClone(c)) }
function cInv(c) { return coord(-c.x, -c.y, -c.z) }       // pure (C# Invert mutates a struct copy)
function cAdd(a, b) { return coord(a.x + b.x, a.y + b.y, a.z + b.z) }
function cScale3(a, b) { return coord(a.x * b.x, a.y * b.y, a.z * b.z) }
function cCross(a, b) {
	return coord(a.y * b.z - b.y * a.z, a.z * b.x - b.z * a.x, a.x * b.y - b.x * a.y)
}

// ---- Quat helpers ------------------------------------------------------------
function qNorm(q) {
	const mag = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
	if (mag > 1e-7) { const o = 1 / mag; q.x *= o; q.y *= o; q.z *= o; q.w *= o }
	else { q.x = 0; q.y = 0; q.z = 0; q.w = 1 }
	return q
}
function quat(axis, angle) {
	const a = cNormed(axis)
	const h = angle * 0.5
	const s = Math.sin(h)
	return qNorm({ x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(h) })
}
function qMul(a, b) {
	return {
		x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
	}
}
// Coord * Quat (rotate vector), per PrimMesher.cs operator *(Coord v, Quat q).
function cRot(v, q) {
	return coord(
		q.w * q.w * v.x + 2 * q.y * q.w * v.z - 2 * q.z * q.w * v.y + q.x * q.x * v.x +
			2 * q.y * q.x * v.y + 2 * q.z * q.x * v.z - q.z * q.z * v.x - q.y * q.y * v.x,
		2 * q.x * q.y * v.x + q.y * q.y * v.y + 2 * q.z * q.y * v.z + 2 * q.w * q.z * v.x -
			q.z * q.z * v.y + q.w * q.w * v.y - 2 * q.x * q.w * v.z - q.x * q.x * v.y,
		2 * q.x * q.z * v.x + 2 * q.y * q.z * v.y + q.z * q.z * v.z - 2 * q.w * q.y * v.x -
			q.y * q.y * v.z + 2 * q.w * q.x * v.y - q.x * q.x * v.z + q.w * q.w * v.z,
	)
}

// ---- AngleList (profile vertex angles + normals) -----------------------------
function ang(angle, X, Y) { return { angle, X, Y } }
const ANGLES3 = [
	ang(0, 1, 0),
	ang(0.3333333333333333, -0.5, 0.8660254037844387),
	ang(0.6666666666666666, -0.5, -0.8660254037844384),
	ang(1, 1, 0),
]
const NORMALS3 = [
	cNormed(coord(0.25, 0.4330127019, 0)),
	cNormed(coord(-0.5, 0, 0)),
	cNormed(coord(0.25, -0.4330127019, 0)),
	cNormed(coord(0.25, 0.4330127019, 0)),
]
const ANGLES4 = [
	ang(0, 1, 0), ang(0.25, 0, 1), ang(0.5, -1, 0), ang(0.75, 0, -1), ang(1, 1, 0),
]
const NORMALS4 = [
	cNormed(coord(0.5, 0.5, 0)), cNormed(coord(-0.5, 0.5, 0)), cNormed(coord(-0.5, -0.5, 0)),
	cNormed(coord(0.5, -0.5, 0)), cNormed(coord(0.5, 0.5, 0)),
]
const ANGLES24 = [
	ang(0, 1, 0), ang(0.041666666666666664, 0.9659258262890683, 0.25881904510252074),
	ang(0.08333333333333333, 0.8660254037844387, 0.5), ang(0.125, 0.7071067811865476, 0.7071067811865475),
	ang(0.16666666666666666, 0.5, 0.8660254037844386), ang(0.20833333333333331, 0.25881904510252096, 0.9659258262890682),
	ang(0.25, 0, 1), ang(0.29166666666666663, -0.25881904510252063, 0.9659258262890683),
	ang(0.3333333333333333, -0.5, 0.8660254037844387), ang(0.375, -0.7071067811865475, 0.7071067811865476),
	ang(0.41666666666666663, -0.8660254037844385, 0.5), ang(0.45833333333333331, -0.9659258262890682, 0.258819045102521),
	ang(0.5, -1, 0), ang(0.5416666666666666, -0.9659258262890684, -0.25881904510252035),
	ang(0.5833333333333333, -0.8660254037844388, -0.5), ang(0.6249999999999999, -0.7071067811865479, -0.7071067811865471),
	ang(0.6666666666666666, -0.5, -0.8660254037844384), ang(0.7083333333333333, -0.2588190451025215, -0.9659258262890681),
	ang(0.75, 0, -1), ang(0.7916666666666666, 0.2588190451025203, -0.9659258262890684),
	ang(0.8333333333333333, 0.5, -0.866025403784439), ang(0.875, 0.7071067811865474, -0.7071067811865477),
	ang(0.9166666666666666, 0.8660254037844384, -0.5), ang(0.9583333333333333, 0.9659258262890681, -0.25881904510252157),
	ang(1, 1, 0),
]

function interpolatePoints(newPoint, p1, p2) {
	const m = (newPoint - p1.angle) / (p2.angle - p1.angle)
	return ang(newPoint, p1.X + m * (p2.X - p1.X), p1.Y + m * (p2.Y - p1.Y))
}

function makeAngles(sides, startAngle, stopAngle) {
	const angles = []
	const normals = []
	let iX = 0, iY = 0
	const intersection = (x1, y1, x2, y2, x3, y3, x4, y4) => {
		const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1)
		const uaN = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)
		if (denom !== 0) { const ua = uaN / denom; iX = x1 + ua * (x2 - x1); iY = y1 + ua * (y2 - y1) }
	}
	if (sides < 1) throw new Error('number of sides not greater than zero')
	if (stopAngle <= startAngle) throw new Error('stopAngle not greater than startAngle')

	if (sides === 3 || sides === 4 || sides === 24) {
		startAngle *= twoPiInv
		stopAngle *= twoPiInv
		const src = sides === 3 ? ANGLES3 : sides === 4 ? ANGLES4 : ANGLES24
		const srcN = sides === 3 ? NORMALS3 : sides === 4 ? NORMALS4 : null
		const startIdx = Math.trunc(startAngle * sides)
		let endIdx = src.length - 1
		if (stopAngle < 1.0) endIdx = Math.trunc(stopAngle * sides) + 1
		if (endIdx === startIdx) endIdx++
		for (let i = startIdx; i < endIdx + 1; i++) {
			angles.push(src[i])
			if (srcN) normals.push(srcN[i])
		}
		if (startAngle > 0.0) angles[0] = interpolatePoints(startAngle, angles[0], angles[1])
		if (stopAngle < 1.0) {
			const last = angles.length - 1
			angles[last] = interpolatePoints(stopAngle, angles[last - 1], angles[last])
		}
	} else {
		const stepSize = twoPi / sides
		const startStep = Math.trunc(startAngle / stepSize)
		let angle = stepSize * startStep
		let step = startStep
		let stopTest = stopAngle
		if (stopAngle < twoPi) {
			stopTest = stepSize * (Math.trunc(stopAngle / stepSize) + 1)
			if (stopTest < stopAngle) stopTest += stepSize
			if (stopTest > twoPi) stopTest = twoPi
		}
		while (angle <= stopTest) {
			angles.push(ang(angle, Math.cos(angle), Math.sin(angle)))
			step += 1
			angle = stepSize * step
		}
		if (startAngle > angles[0].angle) {
			intersection(angles[0].X, angles[0].Y, angles[1].X, angles[1].Y, 0, 0, Math.cos(startAngle), Math.sin(startAngle))
			angles[0] = ang(startAngle, iX, iY)
		}
		const idx = angles.length - 1
		if (stopAngle < angles[idx].angle) {
			intersection(angles[idx - 1].X, angles[idx - 1].Y, angles[idx].X, angles[idx].Y, 0, 0, Math.cos(stopAngle), Math.sin(stopAngle))
			angles[idx] = ang(stopAngle, iX, iY)
		}
	}
	return { angles, normals }
}

// ---- Profile (the extruded cross-section) ------------------------------------
function newFace() { return { primFace: 0, v1: 0, v2: 0, v3: 0, n1: 0, n2: 0, n3: 0, uv1: 0, uv2: 0, uv3: 0 } }

class Profile {
	constructor(sides, profileStart, profileEnd, hollow, hollowSides, createFaces, calcVertexNormals) {
		this.errorMessage = null
		this.calcVertexNormals = !!calcVertexNormals
		this.coords = []
		this.faces = []
		this.vertexNormals = []
		this.us = []
		this.faceUVs = []
		this.faceNumbers = []
		this.outerCoordIndices = null
		this.hollowCoordIndices = null
		this.cut1CoordIndices = null
		this.cut2CoordIndices = null
		this.faceNormal = coord(0, 0, 1)
		this.cutNormal1 = coord()
		this.cutNormal2 = coord()
		this.numOuterVerts = 0
		this.numHollowVerts = 0
		this.outerFaceNumber = -1
		this.hollowFaceNumber = -1
		this.bottomFaceNumber = 0
		this.numPrimFaces = 0
		if (sides === undefined) return  // bare profile (used by Copy)

		const center = coord(0, 0, 0)
		const hollowCoords = []
		const hollowNormals = []
		const hollowUs = []
		if (this.calcVertexNormals) {
			this.outerCoordIndices = []; this.hollowCoordIndices = []
			this.cut1CoordIndices = []; this.cut2CoordIndices = []
		}
		const hasHollow = hollow > 0.0
		const hasProfileCut = profileStart > 0.0 || profileEnd < 1.0

		let xScale = 0.5, yScale = 0.5
		if (sides === 4) { xScale = 0.707107; yScale = 0.707107 }
		const startAngle = profileStart * twoPi
		const stopAngle = profileEnd * twoPi

		let angles
		try { angles = makeAngles(sides, startAngle, stopAngle) }
		catch (ex) { this.errorMessage = 'makeAngles failed: ' + ex; return }
		this.numOuterVerts = angles.angles.length

		const simpleFace = sides < 5 && !hasHollow && !hasProfileCut

		let hollowAngles = { angles: [], normals: [] }
		if (hasHollow) {
			if (sides === hollowSides) hollowAngles = angles
			else {
				try { hollowAngles = makeAngles(hollowSides, startAngle, stopAngle) }
				catch (ex) { this.errorMessage = 'makeAngles failed: ' + ex; return }
			}
			this.numHollowVerts = hollowAngles.angles.length
		} else if (!simpleFace) {
			this.coords.push(center)
			if (this.calcVertexNormals) this.vertexNormals.push(coord(0, 0, 1))
			this.us.push(0.0)
		}

		const z = 0.0
		if (hasHollow && hollowSides !== sides) {
			for (let i = 0; i < hollowAngles.angles.length; i++) {
				const a = hollowAngles.angles[i]
				hollowCoords.push(coord(hollow * xScale * a.X, hollow * yScale * a.Y, z))
				if (this.calcVertexNormals) {
					hollowNormals.push(hollowSides < 5 ? cInv(hollowAngles.normals[i]) : coord(-a.X, -a.Y, 0))
					hollowUs.push(hollowSides === 4 ? a.angle * hollow * 0.707107 : a.angle * hollow)
				}
			}
		}

		let index = 0
		for (let i = 0; i < angles.angles.length; i++) {
			const a = angles.angles[i]
			const v = coord(a.X * xScale, a.Y * yScale, z)
			this.coords.push(v)
			if (this.calcVertexNormals) {
				this.outerCoordIndices.push(this.coords.length - 1)
				if (sides < 5) { this.vertexNormals.push(cClone(angles.normals[i])); this.us.push(a.angle) }
				else { this.vertexNormals.push(coord(a.X, a.Y, 0)); this.us.push(a.angle) }
			}
			if (hasHollow) {
				if (hollowSides === sides) {
					const hv = coord(v.x * hollow, v.y * hollow, z)
					hollowCoords.push(hv)
					if (this.calcVertexNormals) {
						if (sides < 5) hollowNormals.push(cInv(angles.normals[i]))
						else hollowNormals.push(coord(-a.X, -a.Y, 0))
						hollowUs.push(a.angle * hollow)
					}
				}
			} else if (!simpleFace && createFaces && a.angle > 0.0001) {
				const f = newFace(); f.v1 = 0; f.v2 = index; f.v3 = index + 1; this.faces.push(f)
			}
			index += 1
		}

		if (hasHollow) {
			hollowCoords.reverse()
			if (this.calcVertexNormals) { hollowNormals.reverse(); hollowUs.reverse() }
			if (createFaces) {
				const numTotalVerts = this.numOuterVerts + this.numHollowVerts
				if (this.numOuterVerts === this.numHollowVerts) {
					for (let ci = 0; ci < this.numOuterVerts - 1; ci++) {
						let f = newFace(); f.v1 = ci; f.v2 = ci + 1; f.v3 = numTotalVerts - ci - 1; this.faces.push(f)
						f = newFace(); f.v1 = ci + 1; f.v2 = numTotalVerts - ci - 2; f.v3 = numTotalVerts - ci - 1; this.faces.push(f)
					}
				} else if (this.numOuterVerts < this.numHollowVerts) {
					let j = 0; const maxJ = this.numOuterVerts - 1
					for (let i = 0; i < this.numHollowVerts; i++) {
						if (j < maxJ && angles.angles[j + 1].angle - hollowAngles.angles[i].angle < hollowAngles.angles[i].angle - angles.angles[j].angle + 0.000001) {
							const f = newFace(); f.v1 = numTotalVerts - i - 1; f.v2 = j; f.v3 = j + 1; this.faces.push(f); j += 1
						}
						const f = newFace(); f.v1 = j; f.v2 = numTotalVerts - i - 2; f.v3 = numTotalVerts - i - 1; this.faces.push(f)
					}
				} else {
					let j = 0; const maxJ = this.numHollowVerts - 1
					for (let i = 0; i < this.numOuterVerts; i++) {
						if (j < maxJ && hollowAngles.angles[j + 1].angle - angles.angles[i].angle < angles.angles[i].angle - hollowAngles.angles[j].angle + 0.000001) {
							const f = newFace(); f.v1 = i; f.v2 = numTotalVerts - j - 2; f.v3 = numTotalVerts - j - 1; this.faces.push(f); j += 1
						}
						const f = newFace(); f.v1 = numTotalVerts - j - 1; f.v2 = i; f.v3 = i + 1; this.faces.push(f)
					}
				}
			}
			if (this.calcVertexNormals) {
				for (const hc of hollowCoords) { this.coords.push(hc); this.hollowCoordIndices.push(this.coords.length - 1) }
				this.vertexNormals.push(...hollowNormals)
				this.us.push(...hollowUs)
			} else {
				this.coords.push(...hollowCoords)
			}
		}

		if (simpleFace && createFaces) {
			if (sides === 3) { const f = newFace(); f.v1 = 0; f.v2 = 1; f.v3 = 2; this.faces.push(f) }
			else if (sides === 4) {
				let f = newFace(); f.v1 = 0; f.v2 = 1; f.v3 = 2; this.faces.push(f)
				f = newFace(); f.v1 = 0; f.v2 = 2; f.v3 = 3; this.faces.push(f)
			}
		}

		if (this.calcVertexNormals && hasProfileCut) {
			const lastOuter = this.numOuterVerts - 1
			if (hasHollow) {
				this.cut1CoordIndices.push(0); this.cut1CoordIndices.push(this.coords.length - 1)
				this.cut2CoordIndices.push(lastOuter + 1); this.cut2CoordIndices.push(lastOuter)
				this.cutNormal1.x = this.coords[0].y - this.coords[this.coords.length - 1].y
				this.cutNormal1.y = -(this.coords[0].x - this.coords[this.coords.length - 1].x)
				this.cutNormal2.x = this.coords[lastOuter + 1].y - this.coords[lastOuter].y
				this.cutNormal2.y = -(this.coords[lastOuter + 1].x - this.coords[lastOuter].x)
			} else {
				this.cut1CoordIndices.push(0); this.cut1CoordIndices.push(1)
				this.cut2CoordIndices.push(lastOuter); this.cut2CoordIndices.push(0)
				this.cutNormal1.x = this.vertexNormals[1].y
				this.cutNormal1.y = -this.vertexNormals[1].x
				this.cutNormal2.x = -this.vertexNormals[this.vertexNormals.length - 2].y
				this.cutNormal2.y = this.vertexNormals[this.vertexNormals.length - 2].x
			}
			cNorm(this.cutNormal1); cNorm(this.cutNormal2)
		}

		this.makeFaceUVs()

		if (this.calcVertexNormals) {
			// face number order: top, outer, hollow, bottom, start cut, end cut
			let faceNum = 1
			this.outerFaceNumber = faceNum
			const startVert = hasProfileCut && !hasHollow ? 1 : 0
			if (startVert > 0) this.faceNumbers.push(-1)
			for (let i = 0; i < this.numOuterVerts - 1; i++)
				this.faceNumbers.push(sides < 5 && i <= sides ? faceNum++ : faceNum)
			this.faceNumbers.push(hasProfileCut ? -1 : faceNum++)
			if (sides > 4 && (hasHollow || hasProfileCut)) faceNum++
			if (sides < 5 && (hasHollow || hasProfileCut) && this.numOuterVerts < sides) faceNum++
			if (hasHollow) {
				for (let i = 0; i < this.numHollowVerts; i++) this.faceNumbers.push(faceNum)
				this.hollowFaceNumber = faceNum++
			}
			this.bottomFaceNumber = faceNum++
			if (hasHollow && hasProfileCut) this.faceNumbers.push(faceNum++)
			for (let i = 0; i < this.faceNumbers.length; i++) if (this.faceNumbers[i] === -1) this.faceNumbers[i] = faceNum++
			this.numPrimFaces = faceNum
		}
	}

	makeFaceUVs() {
		this.faceUVs = this.coords.map((c) => ({ u: 1.0 - (0.5 + c.x), v: 1.0 - (0.5 - c.y) }))
	}

	copy(needFaces = true) {
		const c = new Profile()
		c.coords = this.coords.map(cClone)
		c.faceUVs = this.faceUVs.map((u) => ({ u: u.u, v: u.v }))
		if (needFaces) c.faces = this.faces.map((f) => ({ ...f }))
		c.calcVertexNormals = this.calcVertexNormals
		if (this.calcVertexNormals) {
			c.vertexNormals = this.vertexNormals.map(cClone)
			c.faceNormal = cClone(this.faceNormal)
			c.cutNormal1 = cClone(this.cutNormal1)
			c.cutNormal2 = cClone(this.cutNormal2)
			c.us = this.us.slice()
			c.faceNumbers = this.faceNumbers.slice()
		}
		c.numOuterVerts = this.numOuterVerts
		c.numHollowVerts = this.numHollowVerts
		return c
	}

	addPos(v) {
		for (const c of this.coords) { c.x += v.x; c.y += v.y; c.z += v.z }
	}

	addRot(q) {
		for (let i = 0; i < this.coords.length; i++) this.coords[i] = cRot(this.coords[i], q)
		if (this.calcVertexNormals) {
			for (let i = 0; i < this.vertexNormals.length; i++) this.vertexNormals[i] = cRot(this.vertexNormals[i], q)
			this.faceNormal = cRot(this.faceNormal, q)
			this.cutNormal1 = cRot(this.cutNormal1, q)
			this.cutNormal2 = cRot(this.cutNormal2, q)
		}
	}

	scale(x, y) {
		for (const c of this.coords) { c.x *= x; c.y *= y }
	}

	flipNormals() {
		for (const f of this.faces) { const t = f.v3; f.v3 = f.v1; f.v1 = t }
		if (this.calcVertexNormals && this.vertexNormals.length > 0)
			this.vertexNormals[this.vertexNormals.length - 1].z *= -1
		this.faceNormal.x = -this.faceNormal.x; this.faceNormal.y = -this.faceNormal.y; this.faceNormal.z = -this.faceNormal.z
		for (const uv of this.faceUVs) uv.v = 1.0 - uv.v
	}

	addValue2FaceVertexIndices(num) {
		for (const f of this.faces) { f.v1 += num; f.v2 += num; f.v3 += num }
	}

	addValue2FaceNormalIndices(num) {
		if (!this.calcVertexNormals) return
		for (const f of this.faces) { f.n1 += num; f.n2 += num; f.n3 += num }
	}
}

// ---- Path (the extrusion spine) ---------------------------------------------
const PathType = { Linear: 0, Circular: 1, Flexible: 2 }

function createPath(p, pathType, steps) {
	const nodes = []
	let taperX = p.taperX, taperY = p.taperY
	if (taperX > 0.999) taperX = 0.999
	if (taperX < -0.999) taperX = -0.999
	if (taperY > 0.999) taperY = 0.999
	if (taperY < -0.999) taperY = -0.999

	if (pathType === PathType.Linear || pathType === PathType.Flexible) {
		const length = p.pathCutEnd - p.pathCutBegin
		const twistTotal = p.twistEnd - p.twistBegin
		const twistTotalAbs = Math.abs(twistTotal)
		if (twistTotalAbs > 0.01) steps += Math.trunc(twistTotalAbs * 3.66)

		const start = -0.5
		const stepSize = length / steps
		const percentOfPathMultiplier = stepSize * 0.999999
		let xOffset = p.topShearX * p.pathCutBegin
		let yOffset = p.topShearY * p.pathCutBegin
		let zOffset = start + p.pathCutBegin
		const xInc = p.topShearX * length / steps
		const yInc = p.topShearY * length / steps
		let percentOfPath = p.pathCutBegin
		let step = 0
		let done = false
		while (!done) {
			let xScale = 1.0
			if (taperX > 0.0) xScale = 1.0 - percentOfPath * taperX
			else if (taperX < 0.0) xScale = 1.0 + (1.0 - percentOfPath) * taperX
			let yScale = 1.0
			if (taperY > 0.0) yScale = 1.0 - percentOfPath * taperY
			else if (taperY < 0.0) yScale = 1.0 + (1.0 - percentOfPath) * taperY
			const twist = p.twistBegin + twistTotal * percentOfPath
			nodes.push({
				xScale, yScale,
				rotation: quat(coord(0, 0, 1), twist),
				position: coord(xOffset, yOffset, zOffset),
				percentOfPath,
			})
			if (step < steps) {
				step += 1
				percentOfPath += percentOfPathMultiplier
				xOffset += xInc; yOffset += yInc; zOffset += stepSize
				if (percentOfPath > p.pathCutEnd) done = true
			} else done = true
		}
	} else {
		const twistTotal = p.twistEnd - p.twistBegin
		const twistTotalAbs = Math.abs(twistTotal)
		if (twistTotalAbs > 0.01) {
			if (twistTotalAbs > Math.PI * 1.5) steps *= 2
			if (twistTotalAbs > Math.PI * 3.0) steps *= 2
		}
		const yPathScale = p.holeSizeY * 0.5
		const pathLength = p.pathCutEnd - p.pathCutBegin
		const totalSkew = p.skew * 2.0 * pathLength
		const skewStart = p.pathCutBegin * 2.0 * p.skew - p.skew
		const xOffsetTopShearXFactor = p.topShearX * (0.25 + 0.5 * (0.5 - p.holeSizeY))
		const yShearComp = 1.0 + Math.abs(p.topShearY) * 0.25

		const startAngle = (twoPi * p.pathCutBegin * p.revolutions) - p.topShearY * 0.9
		const endAngle = (twoPi * p.pathCutEnd * p.revolutions) - p.topShearY * 0.9
		const stepSize = twoPi / p.stepsPerRevolution
		let step = Math.trunc(startAngle / stepSize)
		let angle = startAngle
		let done = false
		while (!done) {
			let xProfileScale = (1.0 - Math.abs(p.skew)) * p.holeSizeX
			let yProfileScale = p.holeSizeY
			const percentOfPath = angle / (twoPi * p.revolutions)
			const percentOfAngles = (angle - startAngle) / (endAngle - startAngle)
			if (taperX > 0.01) xProfileScale *= 1.0 - percentOfPath * taperX
			else if (taperX < -0.01) xProfileScale *= 1.0 + (1.0 - percentOfPath) * taperX
			if (taperY > 0.01) yProfileScale *= 1.0 - percentOfPath * taperY
			else if (taperY < -0.01) yProfileScale *= 1.0 + (1.0 - percentOfPath) * taperY
			let radiusScale = 1.0
			if (p.radius > 0.001) radiusScale = 1.0 - p.radius * percentOfPath
			else if (p.radius < 0.001) radiusScale = 1.0 + p.radius * (1.0 - percentOfPath)
			const twist = p.twistBegin + twistTotal * percentOfPath
			let xOffset = 0.5 * (skewStart + totalSkew * percentOfAngles)
			xOffset += Math.sin(angle) * xOffsetTopShearXFactor
			const yOffset = yShearComp * Math.cos(angle) * (0.5 - yPathScale) * radiusScale
			const zOffset = Math.sin(angle + p.topShearY) * (0.5 - yPathScale) * radiusScale
			let rotation = quat(coord(1, 0, 0), angle + p.topShearY)
			if (twistTotal !== 0.0 || p.twistBegin !== 0.0) rotation = qMul(rotation, quat(coord(0, 0, 1), twist))
			nodes.push({ xScale: xProfileScale, yScale: yProfileScale, position: coord(xOffset, yOffset, zOffset), rotation, percentOfPath })
			if (angle >= endAngle - 0.01) done = true
			else { step += 1; angle = stepSize * step; if (angle > endAngle) angle = endAngle }
		}
	}
	return nodes
}

// ---- PrimMesh (extrude profile along path, build viewer faces) ---------------
class PrimMesh {
	constructor(sides, profileStart, profileEnd, hollow, hollowSides) {
		this.errorMessage = ''
		this.coords = []
		this.faces = []
		this.normals = []
		this.viewerFaces = []
		this.sides = sides < 3 ? 3 : sides
		this.hollowSides = hollowSides < 3 ? 3 : hollowSides
		this.profileStart = profileStart < 0.0 ? 0.0 : profileStart
		this.profileEnd = profileEnd > 1.0 ? 1.0 : profileEnd
		if (this.profileEnd < 0.02) this.profileEnd = 0.02
		if (this.profileStart >= this.profileEnd) this.profileStart = this.profileEnd - 0.02
		this.hollow = hollow > 0.99 ? 0.99 : hollow < 0.0 ? 0.0 : hollow
		this.twistBegin = 0; this.twistEnd = 0
		this.topShearX = 0; this.topShearY = 0
		this.pathCutBegin = 0; this.pathCutEnd = 1
		this.dimpleBegin = 0; this.dimpleEnd = 1
		this.skew = 0
		this.holeSizeX = 1.0; this.holeSizeY = 0.25
		this.taperX = 0; this.taperY = 0
		this.radius = 0; this.revolutions = 1.0
		this.stepsPerRevolution = 24
		this.calcVertexNormals = true   // always on — we want viewer-quality normals + UVs + face numbers
		this.viewerMode = true
		this.sphereMode = false
		this.numPrimFaces = 0
	}

	extrude(pathType) {
		this.coords = []; this.faces = []; this.viewerFaces = []; this.normals = []
		let steps = 1
		const length = this.pathCutEnd - this.pathCutBegin

		if (this.viewerMode && this.sides === 3) {
			if (Math.abs(this.taperX) > 0.01 || Math.abs(this.taperY) > 0.01) steps = Math.trunc(steps * 4.5 * length)
		}
		if (steps < 1) steps = 1

		const hasProfileCut = this.sphereMode
			? this.profileEnd - this.profileStart < 0.4999
			: this.profileEnd - this.profileStart < 0.9999
		const hasHollow = this.hollow > 0.001

		const twistBegin = this.twistBegin / 360.0 * twoPi
		const twistEnd = this.twistEnd / 360.0 * twoPi
		const twistTotal = twistEnd - twistBegin
		const twistTotalAbs = Math.abs(twistTotal)
		if (twistTotalAbs > 0.01) steps += Math.trunc(twistTotalAbs * 3.66)

		let hollow = this.hollow
		let needEndFaces
		if (pathType === PathType.Circular) {
			needEndFaces = (this.pathCutBegin !== 0.0 || this.pathCutEnd !== 1.0 ||
				this.taperX !== 0.0 || this.taperY !== 0.0 || this.skew !== 0.0 ||
				twistTotal !== 0.0 || this.radius !== 0.0)
		} else needEndFaces = true

		let initialProfileRot = 0.0
		if (pathType === PathType.Circular) {
			if (this.sides === 3) {
				initialProfileRot = Math.PI
				if (this.hollowSides === 4) { if (hollow > 0.7) hollow = 0.7; hollow *= 0.707 }
				else hollow *= 0.5
			} else if (this.sides === 4) {
				initialProfileRot = 0.25 * Math.PI
				if (this.hollowSides !== 4) hollow *= 0.707
			} else if (this.sides > 4) {
				initialProfileRot = Math.PI
				if (this.hollowSides === 4) { if (hollow > 0.7) hollow = 0.7; hollow /= 0.7 }
			}
		} else {
			if (this.sides === 3) {
				if (this.hollowSides === 4) { if (hollow > 0.7) hollow = 0.7; hollow *= 0.707 }
				else hollow *= 0.5
			} else if (this.sides === 4) {
				initialProfileRot = 1.25 * Math.PI
				if (this.hollowSides !== 4) hollow *= 0.707
			} else if (this.sides === 24 && this.hollowSides === 4) hollow *= 1.414
		}

		const profile = new Profile(this.sides, this.profileStart, this.profileEnd, hollow, this.hollowSides, true, true)
		this.errorMessage = profile.errorMessage
		if (profile.errorMessage) return
		this.numPrimFaces = profile.numPrimFaces

		let cut1FaceNumber = profile.bottomFaceNumber + 1
		let cut2FaceNumber = cut1FaceNumber + 1
		if (!needEndFaces) { cut1FaceNumber -= 2; cut2FaceNumber -= 2 }

		let cut1Vert = -1, cut2Vert = -1
		if (hasProfileCut) {
			cut1Vert = hasHollow ? profile.coords.length - 1 : 0
			cut2Vert = hasHollow ? profile.numOuterVerts - 1 : profile.numOuterVerts
		}

		if (initialProfileRot !== 0.0) { profile.addRot(quat(coord(0, 0, 1), initialProfileRot)); profile.makeFaceUVs() }

		let lastCutNormal1 = coord(), lastCutNormal2 = coord()
		let lastV = 0.0

		const path = {
			twistBegin, twistEnd, topShearX: this.topShearX, topShearY: this.topShearY,
			pathCutBegin: this.pathCutBegin, pathCutEnd: this.pathCutEnd,
			dimpleBegin: this.dimpleBegin, dimpleEnd: this.dimpleEnd, skew: this.skew,
			holeSizeX: this.holeSizeX, holeSizeY: this.holeSizeY, taperX: this.taperX, taperY: this.taperY,
			radius: this.radius, revolutions: this.revolutions, stepsPerRevolution: this.stepsPerRevolution,
		}
		const nodes = createPath(path, pathType, steps)

		for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
			const node = nodes[nodeIndex]
			const newLayer = profile.copy()
			newLayer.scale(node.xScale, node.yScale)
			newLayer.addRot(node.rotation)
			newLayer.addPos(node.position)

			if (needEndFaces && nodeIndex === 0) {
				newLayer.flipNormals()
				const faceNormal = newLayer.faceNormal
				for (const face of newLayer.faces) {
					const vf = makeViewerFace(profile.bottomFaceNumber)
					vf.v1 = cClone(newLayer.coords[face.v1]); vf.v2 = cClone(newLayer.coords[face.v2]); vf.v3 = cClone(newLayer.coords[face.v3])
					vf.n1 = cClone(faceNormal); vf.n2 = cClone(faceNormal); vf.n3 = cClone(faceNormal)
					vf.uv1 = { ...newLayer.faceUVs[face.v1] }; vf.uv2 = { ...newLayer.faceUVs[face.v2] }; vf.uv3 = { ...newLayer.faceUVs[face.v3] }
					if (pathType === PathType.Linear) { flipCapU(vf.uv1); flipCapU(vf.uv2); flipCapU(vf.uv3) }
					this.viewerFaces.push(vf)
				}
			}

			const coordsLen = this.coords.length
			newLayer.addValue2FaceVertexIndices(coordsLen)
			this.coords.push(...newLayer.coords)
			if (this.calcVertexNormals) { newLayer.addValue2FaceNormalIndices(this.normals.length); this.normals.push(...newLayer.vertexNormals) }
			if (node.percentOfPath < this.pathCutBegin + 0.01 || node.percentOfPath > this.pathCutEnd - 0.01) this.faces.push(...newLayer.faces)

			const numVerts = newLayer.coords.length
			// Side-face V. PrimMesher.cs uses (1 - percentOfPath); the SL viewer (FS LLPath linear/circle
			// path sets mTexT = t, used directly as the side V in LLVolumeFace::createSide) runs V with the
			// path: 0 at the bottom (z=-0.5), 1 at the top. Using 1-percentOfPath renders side textures
			// upside-down (visible on text/oriented textures). WHY: deviation from PrimMesher.cs for FS parity.
			const thisV = node.percentOfPath

			if (nodeIndex > 0) {
				let startVert = coordsLen + 1
				const endVert = this.coords.length
				if (this.sides < 5 || hasProfileCut || hasHollow) startVert--
				for (let i = startVert; i < endVert; i++) {
					let iNext = i + 1
					if (i === endVert - 1) iNext = startVert
					const whichVert = i - startVert

					const f1 = newFace(); f1.v1 = i; f1.v2 = i - numVerts; f1.v3 = iNext; f1.n1 = f1.v1; f1.n2 = f1.v2; f1.n3 = f1.v3; this.faces.push(f1)
					const f2 = newFace(); f2.v1 = iNext; f2.v2 = i - numVerts; f2.v3 = iNext - numVerts; f2.n1 = f2.v1; f2.n2 = f2.v2; f2.n3 = f2.v3; this.faces.push(f2)

					let primFaceNum = profile.faceNumbers[whichVert]
					if (!needEndFaces) primFaceNum -= 1
					const vf1 = makeViewerFace(primFaceNum)
					const vf2 = makeViewerFace(primFaceNum)

					let uIndex = whichVert
					if (!hasHollow && this.sides > 4 && uIndex < newLayer.us.length - 1) uIndex++
					let u1 = newLayer.us[uIndex]
					let u2 = uIndex < newLayer.us.length - 1 ? newLayer.us[uIndex + 1] : 1.0
					if (whichVert === cut1Vert || whichVert === cut2Vert) { u1 = 0.0; u2 = 1.0 }
					else if (this.sides < 5) {
						if (whichVert < profile.numOuterVerts) {
							u1 *= this.sides; u2 *= this.sides; u2 -= Math.trunc(u1); u1 -= Math.trunc(u1)
							if (u2 < 0.1) u2 = 1.0
						}
					}
					if (this.sphereMode && whichVert !== cut1Vert && whichVert !== cut2Vert) {
						u1 = u1 * 2.0 - 1.0; u2 = u2 * 2.0 - 1.0
						if (whichVert >= newLayer.numOuterVerts) { u1 -= hollow; u2 -= hollow }
					}

					vf1.uv1 = { u: u1, v: thisV }; vf1.uv2 = { u: u1, v: lastV }; vf1.uv3 = { u: u2, v: thisV }
					vf2.uv1 = { u: u2, v: thisV }; vf2.uv2 = { u: u1, v: lastV }; vf2.uv3 = { u: u2, v: lastV }

					vf1.v1 = cClone(this.coords[f1.v1]); vf1.v2 = cClone(this.coords[f1.v2]); vf1.v3 = cClone(this.coords[f1.v3])
					vf2.v1 = cClone(this.coords[f2.v1]); vf2.v2 = cClone(this.coords[f2.v2]); vf2.v3 = cClone(this.coords[f2.v3])

					if (whichVert === cut1Vert) {
						vf1.primFaceNumber = cut1FaceNumber; vf2.primFaceNumber = cut1FaceNumber
						vf1.n1 = cClone(newLayer.cutNormal1); vf1.n2 = cClone(lastCutNormal1); vf1.n3 = cClone(lastCutNormal1)
						vf2.n1 = cClone(newLayer.cutNormal1); vf2.n3 = cClone(newLayer.cutNormal1); vf2.n2 = cClone(lastCutNormal1)
					} else if (whichVert === cut2Vert) {
						vf1.primFaceNumber = cut2FaceNumber; vf2.primFaceNumber = cut2FaceNumber
						vf1.n1 = cClone(newLayer.cutNormal2); vf1.n2 = cClone(lastCutNormal2); vf1.n3 = cClone(lastCutNormal2)
						vf2.n1 = cClone(newLayer.cutNormal2); vf2.n3 = cClone(newLayer.cutNormal2); vf2.n2 = cClone(lastCutNormal2)
					} else {
						if ((this.sides < 5 && whichVert < newLayer.numOuterVerts) || (this.hollowSides < 5 && whichVert >= newLayer.numOuterVerts)) {
							calcSurfaceNormal(vf1); calcSurfaceNormal(vf2)
						} else {
							vf1.n1 = cClone(this.normals[f1.n1]); vf1.n2 = cClone(this.normals[f1.n2]); vf1.n3 = cClone(this.normals[f1.n3])
							vf2.n1 = cClone(this.normals[f2.n1]); vf2.n2 = cClone(this.normals[f2.n2]); vf2.n3 = cClone(this.normals[f2.n3])
						}
					}
					this.viewerFaces.push(vf1); this.viewerFaces.push(vf2)
				}
			}

			lastCutNormal1 = newLayer.cutNormal1
			lastCutNormal2 = newLayer.cutNormal2
			lastV = thisV

			if (needEndFaces && nodeIndex === nodes.length - 1) {
				const faceNormal = newLayer.faceNormal
				for (const face of newLayer.faces) {
					const vf = makeViewerFace(0)
					vf.v1 = cClone(newLayer.coords[face.v1 - coordsLen]); vf.v2 = cClone(newLayer.coords[face.v2 - coordsLen]); vf.v3 = cClone(newLayer.coords[face.v3 - coordsLen])
					vf.n1 = cClone(faceNormal); vf.n2 = cClone(faceNormal); vf.n3 = cClone(faceNormal)
					vf.uv1 = { ...newLayer.faceUVs[face.v1 - coordsLen] }; vf.uv2 = { ...newLayer.faceUVs[face.v2 - coordsLen] }; vf.uv3 = { ...newLayer.faceUVs[face.v3 - coordsLen] }
					if (pathType === PathType.Linear) { flipCapU(vf.uv1); flipCapU(vf.uv2); flipCapU(vf.uv3) }
					this.viewerFaces.push(vf)
				}
			}
		}
	}
}

function makeViewerFace(primFaceNumber) {
	return {
		primFaceNumber,
		v1: coord(), v2: coord(), v3: coord(),
		n1: coord(), n2: coord(), n3: coord(),
		uv1: { u: 0, v: 0 }, uv2: { u: 0, v: 0 }, uv3: { u: 0, v: 0 },
	}
}
// Cap-UV mirror. PrimMesher.cs flips BOTH u and v here, but that's physics-meshing convention and
// leaves rendered caps upside-down vs the viewer. The SL viewer (FS LLVolume createCap /
// createUnCutCubeCap, indra/llmath/llvolume.cpp) mirrors only U on caps — top cap v = y+0.5, bottom
// cap v = 0.5-y. The top/bottom V difference comes from flipNormals() (which already flips faceUV v
// on the bottom cap); the extra v-flip PrimMesher.cs does on top of that is what flipped both caps.
// WHY: deliberate deviation from PrimMesher.cs for FS rendering parity.
function flipCapU(uv) { uv.u = 1.0 - uv.u }
function calcSurfaceNormal(vf) {
	const e1 = coord(vf.v2.x - vf.v1.x, vf.v2.y - vf.v1.y, vf.v2.z - vf.v1.z)
	const e2 = coord(vf.v3.x - vf.v1.x, vf.v3.y - vf.v1.y, vf.v3.z - vf.v1.z)
	const n = cNorm(cCross(e1, e2))
	vf.n1 = n; vf.n2 = cClone(n); vf.n3 = cClone(n)
}

// ---- Shape-param mapping (Meshmerizer.GenerateCoordsAndFacesFromPrimShapeData) ----
// LOD → segment counts for round profiles/hollows. High is viewer-default fidelity.
const LOD_SIDES = { high: 24, medium: 12, low: 6, verylow: 3 }

// ProfileShape low-nibble (ProfileCurve & 0x07): 0 Circle, 1 Square, 2 IsoTri, 3 EqualTri, 4 RightTri, 5 HalfCircle
// HollowShape high-nibble (ProfileCurve & 0xf0): 0x00 Same, 0x10 Circle, 0x20 Square, 0x30 Triangle
// Extrusion (PathCurve): 16 Straight (linear), 32/33 Circular, 128 Flexible (treated linear).
function shapeToPrimMesh(shape, lod) {
	const s = shape || {}
	const u8 = (v, d = 0) => (v == null ? d : v)
	const s8 = (v) => { const x = u8(v); return x > 127 ? x - 256 : x } // codec already signs these; guard raw too

	const pathCurve = u8(s.pathCurve, 16)
	const profileCurve = u8(s.profileCurve, 1)
	const sidesFor = LOD_SIDES[lod] ?? LOD_SIDES.high

	const pathShearX = s8(s.pathShearX) * 0.01
	const pathShearY = s8(s.pathShearY) * 0.01
	const pathBegin = u8(s.pathBegin) * 2.0e-5
	const pathEnd = 1.0 - u8(s.pathEnd) * 2.0e-5
	const pathScaleX = (u8(s.pathScaleX, 100) - 100) * 0.01
	const pathScaleY = (u8(s.pathScaleY, 100) - 100) * 0.01

	let profileBegin = u8(s.profileBegin) * 2.0e-5
	let profileEnd = 1.0 - u8(s.profileEnd) * 2.0e-5
	let profileHollow = u8(s.profileHollow) * 2.0e-5
	if (profileHollow > 0.95) profileHollow = 0.95

	const profShape = profileCurve & 0x07
	let sides = 4
	if (profShape === 3) sides = 3                       // equilateral triangle (prism)
	else if (profShape === 0) sides = sidesFor           // circle
	else if (profShape === 5) {                          // half circle → sphere
		sides = sidesFor
		profileBegin = 0.5 * profileBegin + 0.5
		profileEnd = 0.5 * profileEnd + 0.5
	}

	let hollowSides = sides
	const hollowShape = profileCurve & 0xf0
	if (hollowShape === 0x10) hollowSides = sidesFor
	else if (hollowShape === 0x20) hollowSides = 4
	else if (hollowShape === 0x30) hollowSides = 3

	const pm = new PrimMesh(sides, profileBegin, profileEnd, profileHollow, hollowSides)
	pm.topShearX = pathShearX
	pm.topShearY = pathShearY
	pm.pathCutBegin = pathBegin
	pm.pathCutEnd = pathEnd

	const linear = pathCurve === 16 || pathCurve === 128
	if (linear) {
		pm.twistBegin = Math.trunc(s8(s.pathTwistBegin) * 18 / 10)
		pm.twistEnd = Math.trunc(s8(s.pathTwist) * 18 / 10)
		pm.taperX = pathScaleX
		pm.taperY = pathScaleY
		pm.extrude(PathType.Linear)
	} else {
		pm.holeSizeX = (200 - u8(s.pathScaleX, 100)) * 0.01
		pm.holeSizeY = (200 - u8(s.pathScaleY, 100)) * 0.01
		pm.radius = 0.01 * s8(s.pathRadiusOffset)
		pm.revolutions = 1.0 + 0.015 * u8(s.pathRevolutions)
		pm.skew = 0.01 * s8(s.pathSkew)
		pm.twistBegin = Math.trunc(s8(s.pathTwistBegin) * 36 / 10)
		pm.twistEnd = Math.trunc(s8(s.pathTwist) * 36 / 10)
		pm.taperX = s8(s.pathTaperX) * 0.01
		pm.taperY = s8(s.pathTaperY) * 0.01
		pm.extrude(PathType.Circular)
	}
	return pm
}

// Build an SL-space triangle soup from a decoded prim shape. opts.lod ∈ high|medium|low|verylow.
// Triangles with negligible (unit-space) area — e.g. a square profile's closing seam — are dropped.
export function buildPrimMeshArrays(shape, opts = {}) {
	const pm = shapeToPrimMesh(shape, opts.lod || 'high')
	const vf = pm.viewerFaces
	const positions = []
	const normals = []
	const uvs = []
	const faceNumbers = []
	for (const f of vf) {
		// drop degenerate (zero-area) triangles
		const ax = f.v2.x - f.v1.x, ay = f.v2.y - f.v1.y, az = f.v2.z - f.v1.z
		const bx = f.v3.x - f.v1.x, by = f.v3.y - f.v1.y, bz = f.v3.z - f.v1.z
		const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx
		if (cx * cx + cy * cy + cz * cz < 1e-12) continue
		positions.push(f.v1.x, f.v1.y, f.v1.z, f.v2.x, f.v2.y, f.v2.z, f.v3.x, f.v3.y, f.v3.z)
		normals.push(f.n1.x, f.n1.y, f.n1.z, f.n2.x, f.n2.y, f.n2.z, f.n3.x, f.n3.y, f.n3.z)
		uvs.push(f.uv1.u, f.uv1.v, f.uv2.u, f.uv2.v, f.uv3.u, f.uv3.v)
		faceNumbers.push(f.primFaceNumber)
	}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		uvs: new Float32Array(uvs),
		faceNumbers: new Int32Array(faceNumbers),
	}
}
