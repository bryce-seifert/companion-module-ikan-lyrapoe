import { ArtNetTransport } from './artnet.js'
import { SacnTransport, SACN_DEFAULT_PRIORITY } from './sacn.js'
import type { DmxProtocol, DmxTransport } from './types.js'

export * from './types.js'
export * from './artnet.js'
export * from './sacn.js'
export * from './http.js'
export * from './discovery.js'
export * from './fixtures.js'

export function createTransport(protocol: DmxProtocol, host: string): DmxTransport {
	switch (protocol) {
		case 'artnet':
			return new ArtNetTransport({ host, refreshIntervalMs: 1000 })
		case 'sacn':
			return new SacnTransport({
				host,
				sourceName: 'Companion',
				priority: SACN_DEFAULT_PRIORITY,
				refreshIntervalMs: 800,
			})
	}
}
