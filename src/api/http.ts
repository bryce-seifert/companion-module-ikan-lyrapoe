import type { DmxProtocol } from './types.js'

/** Config as exposed by the fixture's built-in web server (firmware 1.2.x) */
export interface FixtureDmxConfig {
	dmxAddress: number
	protocol: DmxProtocol
	artnetUniverse: number
	sacnUniverse: number
}

interface RawArtnetCfg {
	dmx: string
	universe_artnet: string
	universe_sacn: string
	protocol: number
}

async function postJson<T>(ip: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
	const res = await fetch(`http://${ip}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs),
	})
	if (!res.ok) throw new Error(`${path} on ${ip} returned HTTP ${res.status}`)
	return (await res.json()) as T
}

export async function fetchFixtureDmxConfig(ip: string, timeoutMs: number): Promise<FixtureDmxConfig> {
	const raw = await postJson<RawArtnetCfg>(ip, '/artnet_cfg_load', { port: 0 }, timeoutMs)
	return {
		dmxAddress: Number(raw.dmx),
		protocol: raw.protocol === 1 ? 'sacn' : 'artnet',
		artnetUniverse: Number(raw.universe_artnet),
		sacnUniverse: Number(raw.universe_sacn),
	}
}
