import { describe, it, expect } from 'bun:test'
import { buildLoginXml, parseLoginResponse, hashPassword, parseInventorySkeleton, parseInventoryRoot } from '../lib/xmlrpc'

describe('xmlrpc', () => {
	it('hashPassword produces $1$-prefixed md5', () => {
		// echo -n "testpass" | md5sum → 179ad45c6ce2cb97cf1029e212046e81
		expect(hashPassword('testpass')).toBe('$1$179ad45c6ce2cb97cf1029e212046e81')
	})

	it('buildLoginXml produces valid XML-RPC envelope', () => {
		const xml = buildLoginXml({ first: 'John', last: 'Doe', hashedPass: '$1$abc', start: 'last' })
		expect(xml).toContain('<methodName>login_to_simulator</methodName>')
		expect(xml).toContain('<name>first</name>')
		expect(xml).toContain('<string>John</string>')
		expect(xml).toContain('$1$abc')
	})

	it('parseLoginResponse extracts success fields', () => {
		const xml = `<?xml version="1.0"?><methodResponse><params><param><value><struct>
      <member><name>login</name><value><string>true</string></value></member>
      <member><name>session_id</name><value><string>aaaabbbb-0000-1111-2222-ccccddddeeee</string></value></member>
      <member><name>agent_id</name><value><string>11112222-3333-4444-5555-666677778888</string></value></member>
      <member><name>sim_ip</name><value><string>127.0.0.1</string></value></member>
      <member><name>sim_port</name><value><i4>9000</i4></value></member>
      <member><name>circuit_code</name><value><i4>12345</i4></value></member>
      <member><name>seed_capability</name><value><string>https://example.com/cap/abc</string></value></member>
    </struct></value></param></params></methodResponse>`
		const result = parseLoginResponse(xml)
		expect(result.login).toBe(true)
		expect(result.session_id).toBe('aaaabbbb-0000-1111-2222-ccccddddeeee')
		expect(result.sim_port).toBe(9000)
		expect(result.circuit_code).toBe(12345)
	})

	it('parseLoginResponse extracts failure message', () => {
		const xml = `<?xml version="1.0"?><methodResponse><params><param><value><struct>
      <member><name>login</name><value><string>false</string></value></member>
      <member><name>message</name><value><string>Bad credentials</string></value></member>
    </struct></value></param></params></methodResponse>`
		const result = parseLoginResponse(xml)
		expect(result.login).toBe(false)
		expect(result.message).toBe('Bad credentials')
	})

	it('buildLoginXml escapes special XML characters in user-supplied fields', () => {
		const xml = buildLoginXml({ first: 'John & Jane', last: "O'Brien", hashedPass: '$1$abc', start: 'last' })
		expect(xml).toContain('&amp;')
		expect(xml).toContain('&#39;')
		expect(xml).not.toContain('John & Jane')
		expect(xml).not.toMatch(/O'Brien/)
	})

	it('parses inventory skeleton + root from login response', () => {
		const xml = `<?xml version="1.0"?><methodResponse><params><param><value><struct>
      <member><name>login</name><value><string>true</string></value></member>
      <member><name>inventory-root</name><value><array><data>
        <value><struct><member><name>folder_id</name><value><string>11111111-1111-1111-1111-111111111111</string></value></member></struct></value>
      </data></array></value></member>
      <member><name>inventory-skeleton</name><value><array><data>
        <value><struct>
          <member><name>folder_id</name><value><string>11111111-1111-1111-1111-111111111111</string></value></member>
          <member><name>parent_id</name><value><string>00000000-0000-0000-0000-000000000000</string></value></member>
          <member><name>name</name><value><string>My Inventory</string></value></member>
          <member><name>type_default</name><value><i4>8</i4></value></member>
          <member><name>version</name><value><i4>5</i4></value></member>
        </struct></value>
        <value><struct>
          <member><name>folder_id</name><value><string>22222222-2222-2222-2222-222222222222</string></value></member>
          <member><name>parent_id</name><value><string>11111111-1111-1111-1111-111111111111</string></value></member>
          <member><name>name</name><value><string>Objects</string></value></member>
          <member><name>type_default</name><value><i4>6</i4></value></member>
          <member><name>version</name><value><i4>3</i4></value></member>
        </struct></value>
      </data></array></value></member>
    </struct></value></param></params></methodResponse>`
		const result = parseLoginResponse(xml)
		expect(result.inventory_root).toBe('11111111-1111-1111-1111-111111111111')
		expect(result.inventory_skeleton?.length).toBe(2)
		const objects = result.inventory_skeleton?.find(f => f.name === 'Objects')
		expect(objects?.parentId).toBe('11111111-1111-1111-1111-111111111111')
		expect(objects?.typeDefault).toBe(6)
		expect(objects?.version).toBe(3)
		// direct helper calls
		expect(parseInventoryRoot(xml, 'inventory-root')).toBe('11111111-1111-1111-1111-111111111111')
		expect(parseInventorySkeleton(xml).length).toBe(2)
	})

	it('inventory skeleton absent → empty array, no throw', () => {
		const xml = `<?xml version="1.0"?><methodResponse><params><param><value><struct>
      <member><name>login</name><value><string>true</string></value></member>
    </struct></value></param></params></methodResponse>`
		const result = parseLoginResponse(xml)
		expect(result.inventory_skeleton).toEqual([])
		expect(result.inventory_root).toBe('')
	})

	it('parseLoginResponse returns sim_port 0 for malformed integer value', () => {
		const xml = `<?xml version="1.0"?><methodResponse><params><param><value><struct>
      <member><name>login</name><value><string>true</string></value></member>
      <member><name>session_id</name><value><string>aaaabbbb-0000-1111-2222-ccccddddeeee</string></value></member>
      <member><name>agent_id</name><value><string>11112222-3333-4444-5555-666677778888</string></value></member>
      <member><name>sim_ip</name><value><string>127.0.0.1</string></value></member>
      <member><name>sim_port</name><value><i4>notanumber</i4></value></member>
    </struct></value></param></params></methodResponse>`
		const result = parseLoginResponse(xml)
		expect(result.login).toBe(true)
		expect(result.sim_port).toBe(0)
		expect(Number.isNaN(result.sim_port)).toBe(false)
	})
})
