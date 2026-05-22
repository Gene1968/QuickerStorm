/**
 * server/google.ts — Google OAuth token proxy.
 *
 * POST /api/google-token
 * Keeps GOOGLE_CLIENT_SECRET server-side.
 *
 * Supports:
 *   { grantType: 'authorization_code', clientId, code, verifier, redirectUri }
 *   { grantType: 'refresh_token',      clientId, refreshToken }
 */

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
}

function json(data: any, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
	})
}

export async function handleGoogleToken(req: Request): Promise<Response> {
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET
	if (!clientSecret) {
		return json({ error: 'GOOGLE_CLIENT_SECRET not configured on server' }, 503)
	}

	try {
		const body = await req.json().catch(() => ({})) as any
		const { grantType, clientId, code, verifier, redirectUri, refreshToken } = body

		if (!clientId) {
			return json({ error: 'clientId is required' }, 400)
		}

		let params: URLSearchParams
		if (grantType === 'authorization_code') {
			params = new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: redirectUri,
				code_verifier: verifier,
			})
		} else if (grantType === 'refresh_token') {
			params = new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: clientId,
				client_secret: clientSecret,
			})
		} else {
			return json({ error: 'Invalid grantType' }, 400)
		}

		const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: params.toString(),
		})
		const tokens = await tokenRes.json() as any

		if (!tokenRes.ok) {
			return json({ error: tokens.error_description || tokens.error }, 400)
		}

		return json({
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			expires_in: tokens.expires_in,
		})
	} catch (e: any) {
		return json({ error: e.message }, 500)
	}
}
