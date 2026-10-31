import {createHash} from 'node:crypto';
import type * as pulumi from '@pulumi/pulumi';
import {type apps as appsTypes, type core} from '@pulumi/kubernetes/types/input';
import {
	haDataPvc, haConfigmap, mosquittoConfigmap, mosquittoDataPvc, ddclientConfigmap, zigbee2mqttDataPvc, esphomeDataPvc, whisperDataPvc,
	mcpAggregatorDataPvc, starlingBankMcpDataPvc, openfoodfactsMcpDataPvc, olioVolunteerMcpDataPvc, haMcpDataPvc,
	googleWorkspaceMcpDataPvc, whatsappMcpDataPvc, airtableMcpDataPvc, oidcDiscoveryConfigmap,
	personalAgentDataPvc,
} from './storage';
import env from '../env/prod';

// `npx -y <pkg>` starts the server under an `npm exec` parent that stays resident for the
// life of the pod (37-101Mi each, ~460Mi across these pods on 2026-08-23). Install the
// package into the pod at boot instead and run its bin directly. /tmp is writable for the
// non-root `node` user in the mcp-auth-wrapper image; the install costs a few seconds and a
// registry fetch per boot, which is what `npx -y` did anyway.
const npmBootInstall = (pkg: string) => `npm install --no-save --omit=dev --prefix /tmp/srv ${pkg}`;
const npmBin = (pkg: string) => `/tmp/srv/node_modules/.bin/${pkg}`;
// mcp-auth-wrapper's image entrypoint, for pods that run a boot step first.
const execWrapper = 'exec node /app/dist/index.js';
// OAuth redirect URIs our MCP servers hand codes to without a confirmation page: the
// aggregator's upstream callback, plus Claude's (setting this replaces the servers' defaults).
const mcpAllowedRedirectUris = [
	`https://mcp.${env.BASE_DOMAIN}/upstream-auth/callback`,
	'https://claude.ai/api/mcp/auth_callback',
	'https://claude.com/api/mcp/auth_callback',
];

export const apps: AppDefinition[] = [
	{
		name: 'ha',
		targetPort: 8123,
		// subPath mounts don't pick up ConfigMap changes, so restart HA when it changes
		podAnnotations: {
			'checksum/config': haConfigmap.data.apply((data) => createHash('sha256').update(JSON.stringify(data)).digest('hex')),
		},
		spec: {
			// Required for AF_BLUETOOTH sockets — they're scoped to the network namespace,
			// so even a privileged pod can't open HCI sockets without host networking.
			hostNetwork: true,
			dnsPolicy: 'ClusterFirstWithHostNet',
			containers: [{
				name: 'ha',
				image: 'ghcr.io/home-assistant/home-assistant:stable@sha256:1b64d38f38d922bf9d59336451fd6453e1d614f934456af4ee3d2a51061be3a4',
				// Necessary to access the Bluetooth
				securityContext: {
					privileged: true,
				},
				volumeMounts: [
					{
						name: 'ha-data-volume',
						mountPath: '/config',
					},
					{
						name: 'ha-configmap-volume',
						mountPath: '/config/configuration.yaml',
						subPath: 'configuration.yaml',
						readOnly: true,
					},
					{
						name: 'ha-dbus',
						mountPath: '/run/dbus',
						readOnly: true,
					},
				],
			}],
			volumes: [
				{
					name: 'ha-data-volume',
					persistentVolumeClaim: {
						claimName: haDataPvc.metadata.name,
					},
				},
				{
					name: 'ha-configmap-volume',
					configMap: {
						name: haConfigmap.metadata.name,
					},
				},
				// For Bluetooth integration
				{
					name: 'ha-dbus',
					hostPath: {
						path: '/run/dbus',
					},
				},
			],
		},
		ingress: {host: env.BASE_DOMAIN, auth: false},
	},
	{
		name: 'mosquitto',
		targetPort: 1883,
		spec: {
			containers: [{
				name: 'eclipse-mosquitto',
				image: 'eclipse-mosquitto:latest@sha256:860aeb5d63ce509508f6dcfb2bc8a1c1dd2bc60555b562b45ce90e52d8dabb0f',
				volumeMounts: [
					{
						name: 'mosquitto-configmap-volume',
						mountPath: '/mosquitto/config/mosquitto.conf',
						subPath: 'mosquitto.conf',
					},
					{
						name: 'mosquitto-data-volume',
						mountPath: '/mosquitto/data',
					},
				],
			}],
			volumes: [
				{
					name: 'mosquitto-configmap-volume',
					configMap: {
						name: mosquittoConfigmap.metadata.name,
					},
				},
				{
					name: 'mosquitto-data-volume',
					persistentVolumeClaim: {
						claimName: mosquittoDataPvc.metadata.name,
					},
				},
			],
		},
	},
	{
		name: 'zigbee2mqtt',
		targetPort: 8080,
		// The Zigbee USB stick can only be held by one process at a time. With the default
		// RollingUpdate, the new pod boots while the old still owns /dev/ttyUSB0 and crashes
		// with "Cannot lock port" until the old pod terminates.
		strategy: {type: 'Recreate'},
		spec: {
			containers: [{
				name: 'zigbee2mqtt',
				image: 'koenkk/zigbee2mqtt:latest@sha256:2a21bbf7a664a149024bbe1f776e3151f28ed9db15948270dcbffb89544a41f0',
				// Necessary to access the USB Zigbee stick
				securityContext: {
					privileged: true,
				},
				// Z2M persists these into its configuration.yaml on startup
				env: [
					{name: 'ZIGBEE2MQTT_CONFIG_HOMEASSISTANT_ENABLED', value: 'true'},
					{name: 'ZIGBEE2MQTT_CONFIG_MQTT_BASE_TOPIC', value: 'zigbee2mqtt'},
					{name: 'ZIGBEE2MQTT_CONFIG_MQTT_SERVER', value: 'mqtt://mosquitto-svc:80'},
					{name: 'ZIGBEE2MQTT_CONFIG_SERIAL_ADAPTER', value: 'zstack'},
					{name: 'ZIGBEE2MQTT_CONFIG_SERIAL_PORT', value: '/dev/ttyUSB0'},
					{name: 'ZIGBEE2MQTT_CONFIG_FRONTEND_ENABLED', value: 'true'},
					{name: 'ZIGBEE2MQTT_CONFIG_FRONTEND_PORT', value: '8080'},
				],
				volumeMounts: [
					{
						name: 'zigbee2mqtt-data-volume',
						mountPath: '/app/data',
					},
					// Access to the USB Zigbee stick
					{
						name: 'zigbee2mqtt-usb-volume',
						mountPath: '/dev/ttyUSB0',
					},
				],
			}],
			volumes: [
				{
					name: 'zigbee2mqtt-data-volume',
					persistentVolumeClaim: {
						claimName: zigbee2mqttDataPvc.metadata.name,
					},
				},
				{
					name: 'zigbee2mqtt-udev-volume',
					hostPath: {
						path: '/run/udev',
					},
				},
				{
					name: 'zigbee2mqtt-usb-volume',
					hostPath: {
						path: '/dev/ttyUSB0',
					},
				},
			],
		},
		ingress: {host: `z2m.${env.BASE_DOMAIN}`, auth: true},
	},
	{
		name: 'ddclient',
		spec: {
			containers: [{
				name: 'ddclient',
				image: 'linuxserver/ddclient:latest@sha256:cf9c8c2ba0397dc689afd2f438b94d1ff7e5ff54ed4f00bcab43b04fb35fa462',
				volumeMounts: [
					{
						name: 'ddclient-configmap-volume',
						mountPath: '/defaults/ddclient.conf',
						subPath: 'ddclient.conf',
					},
				],
			}],
			volumes: [
				{
					name: 'ddclient-configmap-volume',
					configMap: {
						name: ddclientConfigmap.metadata.name,
					},
				},
			],
		},
	},
	// Traefik ForwardAuth target for apps with `ingress.auth`. Unauthenticated requests get
	// a 302 straight to login, carrying the original URL (from X-Forwarded-*) to return to.
	{
		name: 'oauth2-proxy',
		targetPort: 4180,
		spec: {
			containers: [{
				name: 'oauth2-proxy',
				image: 'quay.io/oauth2-proxy/oauth2-proxy:v7.15.5@sha256:8498b0d0ef0a7b29686414000a08aee467f02d0299c9ed1e006a8f33fc017916',
				args: [
					'--http-address=:4180',
					'--provider=oidc',
					`--oidc-issuer-url=https://oidc.${env.BASE_DOMAIN}`,
					'--client-id=oauth2-proxy',
					// hass-oidc-provider clients are public (PKCE, no secret), but oauth2-proxy insists on one
					'--client-secret=unused',
					'--code-challenge-method=S256',
					// hass-oidc-provider issues no email claim, so identify users by HA user id
					'--oidc-email-claim=sub',
					'--skip-claims-from-profile-url',
					'--email-domain=*',
					`--redirect-url=https://auth-proxy.${env.BASE_DOMAIN}/oauth2/callback`,
					// Covers both the apps and the callback host, so one login works everywhere
					`--cookie-domain=.${env.BASE_DOMAIN}`,
					`--whitelist-domain=.${env.BASE_DOMAIN}`,
					'--cookie-secure',
					'--reverse-proxy',
					'--upstream=static://202',
					'--skip-provider-button',
				],
				env: [{
					name: 'OAUTH2_PROXY_COOKIE_SECRET',
					value: env.OAUTH2_PROXY_COOKIE_SECRET,
				}],
			}],
		},
		ingress: {host: `auth-proxy.${env.BASE_DOMAIN}`, auth: false},
	},
	{
		name: 'esphome',
		targetPort: 6052,
		// Python's asyncio binds `::` as IPv6-only, so the dashboard can't listen on both
		ipv4Only: true,
		spec: {
			containers: [{
				name: 'esphome',
				image: 'ghcr.io/esphome/esphome:latest@sha256:776a845d508909bf426d2ee7bdd81796361ebe6a7f091807ce1d6d0b48985413',
				env: [{
					name: 'ESPHOME_DASHBOARD_USE_PING',
					value: 'true',
				}],
				volumeMounts: [
					{
						name: 'esphome-data-volume',
						mountPath: '/config',
					},
				],
			}],
			volumes: [
				{
					name: 'esphome-data-volume',
					persistentVolumeClaim: {
						claimName: esphomeDataPvc.metadata.name,
					},
				},
			],
		},
		ingress: {host: `esphome.${env.BASE_DOMAIN}`, auth: true},
	},
	// The int8 transducer 110m model files are pre-populated in the PVC manually.
	// Upstream sherpa-onnx publishes only the fp32 transducer and CTC int8 (which doesn't
	// load via wyoming-whisper's `from_transducer` call), so this int8 transducer was
	// produced by running onnxruntime's `quantize_dynamic` (MatMul-only) on the fp32 ONNX
	// files from HF `csukuangfj/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000`,
	// then `kubectl cp`'d into the whisper PVC. If the PVC is ever recreated, wyoming-whisper
	// will hit its hardcoded URL and 404. Tracking upstream:
	// https://github.com/k2-fsa/sherpa-onnx/issues/3570
	{
		name: 'whisper',
		targetPort: 10300,
		spec: {
			containers: [{
				name: 'whisper',
				image: 'rhasspy/wyoming-whisper:3.1.0@sha256:9501d2659eee83b6eead98d53842193e5fed011eda6c5b1c3ad36f3146b28fed',
				args: ['--stt-library', 'sherpa', '--model', 'sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8', '--language', 'en'],
				volumeMounts: [
					{
						name: 'whisper-data-volume',
						mountPath: '/data',
					},
				],
			}],
			volumes: [
				{
					name: 'whisper-data-volume',
					persistentVolumeClaim: {
						claimName: whisperDataPvc.metadata.name,
					},
				},
			],
		},
	},
	// Microsoft Edge TTS via wyoming-edge-tts: a single Rust binary that speaks
	// Wyoming on one side and Microsoft's free read-aloud WebSocket on the other.
	// Replaces the prior wyoming_openai + travisvn/openai-edge-tts two-container
	// stack — saves ~250 MB RSS, cuts time-to-first-audio by 3-6×.
	{
		name: 'edge-tts',
		targetPort: 10210,
		spec: {
			containers: [{
				name: 'edge-tts',
				image: 'ghcr.io/domdomegg/wyoming-edge-tts:0.1.3@sha256:95ee5f48299c5e59fae33a933b00a6611fe48a56fe4375aeed6d2480794f38fc',
			}],
		},
	},
	// ── MCP gateway ──
	// Auth principle for every MCP server behind the aggregator: per-person self-serve auth.
	// Each user authorizes their own account through the OAuth flow (or supplies their own
	// per-user token via the auth wrapper) — we never hardcode shared/per-user credentials,
	// and never put user credentials in a Pulumi secret. App-level OAuth client id/secret is
	// fine; user-identifying tokens must be self-served, not provisioned by us.
	{
		name: 'hass-oidc-provider',
		targetPort: 3001,
		spec: {
			containers: [{
				name: 'hass-oidc-provider',
				image: 'ghcr.io/domdomegg/hass-oidc-provider:latest@sha256:63c061a5bf6b6cfd3dad759afed4e49f334e4ae13e8d54f4676e89c4d2916bbf',
				env: [{
					name: 'HASS_OIDC_CONFIG',
					value: JSON.stringify({
						hassUrl: `https://${env.BASE_DOMAIN}`,
						externalUrl: `https://oidc.${env.BASE_DOMAIN}`,
						signingKey: env.HASS_OIDC_SIGNING_KEY,
					}),
				}],
			}],
		},
		ingress: {host: `oidc.${env.BASE_DOMAIN}`, auth: false},
	},
	// Google MCP servers (native OAuth to Google)
	...([
		'gmail',
		'google-cal',
		'google-contacts',
		'google-documents',
		'google-drive',
		'google-maps-places',
		'google-sheets',
	]).map((name) => ({
		name: `${name}-mcp`,
		targetPort: 3000,
		spec: {
			containers: [{
				name: `${name}-mcp`,
				image: 'node:lts-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03',
				command: ['sh', '-c', `${npmBootInstall(`${name}-mcp`)} && exec ${npmBin(`${name}-mcp`)}`],
				env: [
					{name: 'MCP_TRANSPORT', value: 'http'},
					{name: 'GOOGLE_CLIENT_ID', value: env.GOOGLE_MCP_CLIENT_ID},
					{name: 'GOOGLE_CLIENT_SECRET', value: env.GOOGLE_MCP_CLIENT_SECRET},
					{name: 'MCP_BASE_URL', value: `https://${name}.mcp.${env.BASE_DOMAIN}`},
					{name: 'ALLOWED_REDIRECT_URIS', value: mcpAllowedRedirectUris.join(',')},
				],
			}],
		},
		ingress: {host: `${name}.mcp.${env.BASE_DOMAIN}`, auth: false},
	})),

	// Google Workspace MCP (taylorwilsdon/google_workspace_mcp) — Python, runs via uvx.
	// Single comprehensive server (Gmail, Drive, Calendar, Docs, Sheets, Slides, Forms, Tasks,
	// Contacts, Chat, Apps Script) using its own OAuth 2.1 multi-user mode: each user self-serves
	// a Google authorization via the /oauth2callback flow, tokens persisted per-user to the PVC.
	// Reuses the shared GOOGLE_MCP OAuth client — the redirect URI
	// https://google-workspace.mcp.${BASE_DOMAIN}/oauth2callback must be registered on that client.
	// NB: runs as root so it can write its credentials + caches to the PVC.
	{
		// Runs Adam's fork at a pinned commit rather than the PyPI release: it carries the
		// generic api_call tool (upstream PR taylorwilsdon/google_workspace_mcp#885, still
		// open) rebased onto v1.25.0, plus WORKSPACE_MCP_EXTRA_SCOPES and a fix to listen on
		// both IPv4 and IPv6 by default (upstream PR taylorwilsdon/google_workspace_mcp#1269).
		// Bump the SHA to pick up changes; drop the --from once upstream ships all three.
		name: 'google-workspace-mcp',
		targetPort: 8000,
		spec: {
			containers: [{
				name: 'google-workspace-mcp',
				// uv + python baked in: the previous node image ran apk add + pip install uv on
				// every boot, and a DNS blip mid-install crashed the pod on 2026-08-20.
				image: 'ghcr.io/astral-sh/uv:python3.12-alpine@sha256:8a8e1becc4af37b754fa36eb75e26340e3e4d421542b7c4fdc6bced966abd6bf',
				command: ['uvx', '--from', 'https://github.com/domdomegg/google_workspace_mcp/archive/369427fb8eafc919c2cdf3c9f706af5779e12ceb.zip', 'workspace-mcp', '--transport', 'streamable-http', '--tool-tier', 'complete'],
				securityContext: {runAsUser: 0},
				env: [
					{name: 'MCP_ENABLE_OAUTH21', value: 'true'},
					// The OAuth-proxy state (registered MCP clients, refresh tokens) defaults to
					// memory, so every restart silently invalidated the aggregator's credentials
					// (dead 2026-08-20 -> 23). Keep it on the PVC next to the Google credentials.
					{name: 'WORKSPACE_MCP_OAUTH_PROXY_STORAGE_BACKEND', value: 'disk'},
					{name: 'WORKSPACE_MCP_OAUTH_PROXY_DISK_DIRECTORY', value: '/app/data/oauth-proxy'},
					// Cache the resolved package on the PVC so restarts do not depend on the network.
					{name: 'UV_CACHE_DIR', value: '/app/data/uv-cache'},
					// cloud-platform lets api_call reach the Places API (what google-maps-places-mcp
					// needs), so that pod can go too. Broad scope: it covers Adam's whole GCP.
					// Scopes are fixed at auth time - re-auth after changing this.
					{name: 'WORKSPACE_MCP_EXTRA_SCOPES', value: 'https://www.googleapis.com/auth/cloud-platform'},
					{name: 'GOOGLE_OAUTH_CLIENT_ID', value: env.GOOGLE_MCP_CLIENT_ID},
					{name: 'GOOGLE_OAUTH_CLIENT_SECRET', value: env.GOOGLE_MCP_CLIENT_SECRET},
					{name: 'WORKSPACE_MCP_PORT', value: '8000'},
					{name: 'WORKSPACE_EXTERNAL_URL', value: `https://google-workspace.mcp.${env.BASE_DOMAIN}`},
					{name: 'WORKSPACE_MCP_CREDENTIALS_DIR', value: '/app/data/credentials'},
				],
				volumeMounts: [{
					name: 'mcp-data-volume',
					mountPath: '/app/data',
				}],
			}],
			volumes: [{
				name: 'mcp-data-volume',
				persistentVolumeClaim: {
					claimName: googleWorkspaceMcpDataPvc.metadata.name,
				},
			}],
		},
		ingress: {host: `google-workspace.mcp.${env.BASE_DOMAIN}`, auth: false},
	},

	// Starling Bank MCP (via mcp-auth-wrapper + hass-oidc-provider)
	// NB: mcp-auth-wrapper runs as non-root `node` user (uid 1000). If copying this configuration and using a PVC, you may need
	// securityContext: { fsGroup: 1000 } on the pod spec for write access.
	{
		name: 'starling-bank-mcp',
		targetPort: 3000,
		spec: {
			containers: [{
				name: 'starling-bank-mcp',
				image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:c92c1e5f30798bf995e97351e26e9dd3663b3022ff7ea176e03ec5a91f3fa902',
				command: ['sh', '-c', `${npmBootInstall('starling-bank-mcp')} && ${execWrapper}`],
				env: [{
					name: 'MCP_AUTH_WRAPPER_CONFIG',
					value: JSON.stringify({
						command: [npmBin('starling-bank-mcp')],
						auth: {issuer: `https://oidc.${env.BASE_DOMAIN}`},
						allowedRedirectUris: mcpAllowedRedirectUris,
						envPerUser: [
							{name: 'STARLING_BANK_ACCESS_TOKEN', label: 'Starling Bank Access Token', secret: true},
						],
						storage: '/app/data/mcp.sqlite',
						issuerUrl: `https://starling-bank.mcp.${env.BASE_DOMAIN}`,
						secret: env.MCP_AUTH_WRAPPER_SECRET,
					}),
				}],
				volumeMounts: [{
					name: 'mcp-data-volume',
					mountPath: '/app/data',
				}],
			}],
			volumes: [{
				name: 'mcp-data-volume',
				persistentVolumeClaim: {
					claimName: starlingBankMcpDataPvc.metadata.name,
				},
			}],
		},
		ingress: {host: `starling-bank.mcp.${env.BASE_DOMAIN}`, auth: false},
	},

	// Airtable MCP (domdomegg/airtable-mcp-server, via mcp-auth-wrapper + hass-oidc-provider).
	// Per-user Airtable personal access token. Read+write across the user's bases.
	// NB: mcp-auth-wrapper runs as non-root `node` user (uid 1000); fsGroup set for PVC write access.
	{
		name: 'airtable-mcp',
		targetPort: 3000,
		spec: {
			securityContext: {fsGroup: 1000},
			containers: [{
				name: 'airtable-mcp',
				image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:c92c1e5f30798bf995e97351e26e9dd3663b3022ff7ea176e03ec5a91f3fa902',
				command: ['sh', '-c', `${npmBootInstall('airtable-mcp-server')} && ${execWrapper}`],
				env: [{
					name: 'MCP_AUTH_WRAPPER_CONFIG',
					value: JSON.stringify({
						command: [npmBin('airtable-mcp-server')],
						auth: {issuer: `https://oidc.${env.BASE_DOMAIN}`},
						allowedRedirectUris: mcpAllowedRedirectUris,
						envPerUser: [
							{name: 'AIRTABLE_API_KEY', label: 'Airtable Personal Access Token', secret: true},
						],
						storage: '/app/data/mcp.sqlite',
						issuerUrl: `https://airtable.mcp.${env.BASE_DOMAIN}`,
						secret: env.MCP_AUTH_WRAPPER_SECRET,
					}),
				}],
				volumeMounts: [{
					name: 'mcp-data-volume',
					mountPath: '/app/data',
				}],
			}],
			volumes: [{
				name: 'mcp-data-volume',
				persistentVolumeClaim: {
					claimName: airtableMcpDataPvc.metadata.name,
				},
			}],
		},
		ingress: {host: `airtable.mcp.${env.BASE_DOMAIN}`, auth: false},
	},

	// OpenFoodFacts MCP (via mcp-auth-wrapper + hass-oidc-provider)
	// NB: mcp-auth-wrapper runs as non-root `node` user (uid 1000). If copying this configuration and using a PVC, you may need
	// securityContext: { fsGroup: 1000 } on the pod spec for write access.
	{
		name: 'openfoodfacts-mcp',
		targetPort: 3000,
		spec: {
			containers: [{
				name: 'openfoodfacts-mcp',
				image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:c92c1e5f30798bf995e97351e26e9dd3663b3022ff7ea176e03ec5a91f3fa902',
				command: ['sh', '-c', `${npmBootInstall('openfoodfacts-mcp')} && ${execWrapper}`],
				env: [{
					name: 'MCP_AUTH_WRAPPER_CONFIG',
					value: JSON.stringify({
						command: [npmBin('openfoodfacts-mcp')],
						auth: {issuer: `https://oidc.${env.BASE_DOMAIN}`},
						allowedRedirectUris: mcpAllowedRedirectUris,
						envPerUser: [
							{name: 'OFF_USER_AGENT', label: 'User Agent (e.g. MyApp/1.0 (email@example.com))'},
							{name: 'OFF_USER_ID', label: 'OpenFoodFacts Username (optional)'},
							{name: 'OFF_PASSWORD', label: 'OpenFoodFacts Password (optional)', secret: true},
						],
						storage: '/app/data/mcp.sqlite',
						issuerUrl: `https://openfoodfacts.mcp.${env.BASE_DOMAIN}`,
						secret: env.MCP_AUTH_WRAPPER_SECRET,
					}),
				}],
				volumeMounts: [{
					name: 'mcp-data-volume',
					mountPath: '/app/data',
				}],
			}],
			volumes: [{
				name: 'mcp-data-volume',
				persistentVolumeClaim: {
					claimName: openfoodfactsMcpDataPvc.metadata.name,
				},
			}],
		},
		ingress: {host: `openfoodfacts.mcp.${env.BASE_DOMAIN}`, auth: false},
	},

	// Olio Volunteer Hub MCP (via mcp-auth-wrapper, per-user _session_id cookie)
	{
		name: 'olio-volunteer-mcp',
		targetPort: 3000,
		spec: {
			containers: [{
				name: 'olio-volunteer-mcp',
				image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:c92c1e5f30798bf995e97351e26e9dd3663b3022ff7ea176e03ec5a91f3fa902',
				command: ['sh', '-c', `${npmBootInstall('olio-volunteer-mcp')} && ${execWrapper}`],
				env: [{
					name: 'MCP_AUTH_WRAPPER_CONFIG',
					value: JSON.stringify({
						command: [npmBin('olio-volunteer-mcp')],
						auth: {issuer: `https://oidc.${env.BASE_DOMAIN}`},
						allowedRedirectUris: mcpAllowedRedirectUris,
						envPerUser: [
							{name: 'OLIO_SESSION_ID', label: 'Olio Volunteer Hub _session_id cookie', secret: true},
						],
						storage: '/app/data/mcp.sqlite',
						issuerUrl: `https://olio.mcp.${env.BASE_DOMAIN}`,
						secret: env.MCP_AUTH_WRAPPER_SECRET,
					}),
				}],
				volumeMounts: [{
					name: 'mcp-data-volume',
					mountPath: '/app/data',
				}],
			}],
			volumes: [{
				name: 'mcp-data-volume',
				persistentVolumeClaim: {
					claimName: olioVolunteerMcpDataPvc.metadata.name,
				},
			}],
		},
		ingress: {host: `olio.mcp.${env.BASE_DOMAIN}`, auth: false},
	},

	// Home Assistant MCP (via mcp-auth-wrapper + hass-oidc-provider, per-user HA tokens)
	// NB: runs as root to install Python/uv at startup. Spawns ha-mcp (Python, stdio) via uvx.
	{
		name: 'ha-mcp',
		targetPort: 3000,
		spec: {
			containers: [{
				name: 'ha-mcp',
				image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:c92c1e5f30798bf995e97351e26e9dd3663b3022ff7ea176e03ec5a91f3fa902',
				// Root, so the boot step can apk/pip install. uv tool install puts a real `ha-mcp` bin
				// on PATH; `uvx ha-mcp` would leave a 42Mi uv launcher resident beside the server.
				command: ['sh', '-c'],
				args: [
					`apk add --no-cache python3 py3-pip && python3 -m pip install --break-system-packages uv && UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install ha-mcp==7.3.0 && ${execWrapper}`,
				],
				securityContext: {runAsUser: 0},
				env: [
					{name: 'HOMEASSISTANT_URL', value: 'http://ha-svc:80'},
					{
						name: 'MCP_AUTH_WRAPPER_CONFIG',
						value: JSON.stringify({
							command: ['ha-mcp'],
							auth: {issuer: `https://oidc.${env.BASE_DOMAIN}`},
							allowedRedirectUris: mcpAllowedRedirectUris,
							envPerUser: [
								{name: 'HOMEASSISTANT_TOKEN', label: 'Home Assistant Long-Lived Access Token', secret: true},
							],
							storage: '/app/data/mcp.sqlite',
							issuerUrl: `https://ha.mcp.${env.BASE_DOMAIN}`,
							secret: env.MCP_AUTH_WRAPPER_SECRET,
						}),
					},
				],
				volumeMounts: [{
					name: 'mcp-data-volume',
					mountPath: '/app/data',
				}],
			}],
			volumes: [{
				name: 'mcp-data-volume',
				persistentVolumeClaim: {
					claimName: haMcpDataPvc.metadata.name,
				},
			}],
		},
		ingress: {host: `ha.mcp.${env.BASE_DOMAIN}`, auth: false},
	},

	// WhatsApp MCP (domdomegg/whatsapp-mcp-extended): one Go binary that is both the whatsmeow
	// client and an MCP server on stdio. The image's entrypoint is mcp-auth-wrapper, which gates
	// access via hass-oidc-provider and spawns one /app/whatsapp-mcp per authenticated user and
	// profile (MCP_USER_ID + MCP_PROFILE_ID); each gets its own store/<user>/<profile>/ (whatsmeow
	// session + history). Onboard via the get_setup_qr tool (scan in WhatsApp > Linked Devices).
	// Unofficial API (ban risk). Runs as non-root (uid 1000), so fsGroup is set for PVC writes.
	{
		name: 'whatsapp-mcp',
		targetPort: 3000,
		spec: {
			securityContext: {fsGroup: 1000},
			containers: [{
				name: 'whatsapp-mcp',
				image: 'ghcr.io/domdomegg/whatsapp-mcp-extended:latest',
				env: [{
					name: 'MCP_AUTH_WRAPPER_CONFIG',
					value: JSON.stringify({
						command: ['/app/whatsapp-mcp'],
						auth: {issuer: `https://oidc.${env.BASE_DOMAIN}`},
						allowedRedirectUris: mcpAllowedRedirectUris,
						storage: '/app/data/mcp.sqlite',
						issuerUrl: `https://whatsapp.mcp.${env.BASE_DOMAIN}`,
						secret: env.MCP_AUTH_WRAPPER_SECRET,
					}),
				}],
				volumeMounts: [{
					name: 'mcp-data-volume',
					mountPath: '/app/data',
				}],
				// Liveness: each per-account process writes a status file every 15s and
				// `whatsapp-mcp healthcheck` reads them all; it fails when a linked account has
				// been disconnected for more than 2 minutes or a live process stopped writing.
				// Exited processes are not failures (the wrapper respawns on the next call) and
				// unlinked accounts are ignored, so the pod never restart-loops on a QR wait.
				// 6 x 30s ≈ 3 min before the restart.
				livenessProbe: {
					exec: {command: ['/app/whatsapp-mcp', 'healthcheck']},
					initialDelaySeconds: 60,
					periodSeconds: 30,
					timeoutSeconds: 10,
					failureThreshold: 6,
				},
			}],
			volumes: [{
				name: 'mcp-data-volume',
				persistentVolumeClaim: {
					claimName: whatsappMcpDataPvc.metadata.name,
				},
			}],
		},
		ingress: {host: `whatsapp.mcp.${env.BASE_DOMAIN}`, auth: false},
	},

	// Barcode Scanner MCP (no auth). No public ingress: only reachable via the aggregator.
	{
		name: 'barcode-scanner-mcp',
		targetPort: 3000,
		spec: {
			containers: [{
				name: 'barcode-scanner-mcp',
				image: 'node:lts-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03',
				command: ['sh', '-c', `${npmBootInstall('barcode-scanner-mcp')} && exec ${npmBin('barcode-scanner-mcp')}`],
				env: [
					{name: 'MCP_TRANSPORT', value: 'http'},
				],
			}],
		},
	},

	// Benepass MCP (no auth — server is fully stateless, every tool call carries its own
	// refresh_token). No public ingress: only reachable in-cluster, via the OIDC-gated aggregator.
	{
		name: 'benepass-mcp',
		targetPort: 3000,
		spec: {
			containers: [{
				name: 'benepass-mcp',
				image: 'node:lts-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03',
				command: ['sh', '-c', `${npmBootInstall('benepass-mcp')} && exec ${npmBin('benepass-mcp')}`],
				env: [
					{name: 'MCP_TRANSPORT', value: 'http'},
				],
			}],
		},
	},

	// MCP Local Tunnel relay (bridges agent WebSocket connections to MCP endpoint)
	{
		name: 'mcp-local-tunnel',
		targetPort: 3000,
		spec: {
			containers: [{
				name: 'mcp-local-tunnel',
				image: 'ghcr.io/domdomegg/mcp-local-tunnel:latest@sha256:7ee950f2aa99dd79b3a0d41b57e64bb00148eae113b6510b5a519280f9e97643',
				env: [{
					name: 'MCP_LOCAL_TUNNEL_CONFIG',
					value: JSON.stringify({
						mode: 'relay',
						auth: {issuer: `https://oidc.${env.BASE_DOMAIN}`},
						allowedRedirectUris: mcpAllowedRedirectUris,
						issuerUrl: `https://tunnel.mcp.${env.BASE_DOMAIN}`,
						secret: env.MCP_LOCAL_TUNNEL_SECRET,
					}),
				}],
			}],
		},
		ingress: {host: `tunnel.mcp.${env.BASE_DOMAIN}`, auth: false},
	},

	// MCP Aggregator (aggregates all upstream MCP servers behind a single OAuth endpoint)
	// NB: mcp-aggregator runs as non-root `node` user (uid 1000). If copying this configuration and using a PVC, you may need
	// securityContext: { fsGroup: 1000 } on the pod spec for write access.
	{
		name: 'mcp-aggregator',
		targetPort: 3000,
		spec: {
			containers: [{
				name: 'mcp-aggregator',
				image: 'ghcr.io/domdomegg/mcp-aggregator:latest@sha256:a683eb3cd650f1bc0df4975d267d7b847958f34f262703dfbcada6d813e5bc84',
				env: [{
					name: 'MCP_AGGREGATOR_CONFIG',
					value: JSON.stringify({
						auth: {
							issuer: `https://oidc.${env.BASE_DOMAIN}`,
							clientId: 'mcp-aggregator',
						},
						// In-cluster upstreams use their service DNS names directly: going via
						// the public hostname hairpins through the ingress and re-does TLS on
						// every connection (~130ms/request vs ~5ms internal), and the
						// aggregator connects per call. OAuth still works: the wrappers serve
						// their discovery metadata on any Host, and the endpoints they
						// advertise there are the public URLs.
						upstreams: [
							{name: 'gmail', url: 'http://gmail-mcp-svc/mcp'},
							{name: 'gmail-2', url: 'http://gmail-mcp-svc/mcp'},
							{name: 'google-cal', url: 'http://google-cal-mcp-svc/mcp'},
							{name: 'google-contacts', url: 'http://google-contacts-mcp-svc/mcp'},
							{name: 'google-documents', url: 'http://google-documents-mcp-svc/mcp'},
							{name: 'google-drive', url: 'http://google-drive-mcp-svc/mcp'},
							{name: 'google-maps-places', url: 'http://google-maps-places-mcp-svc/mcp'},
							{name: 'google-sheets', url: 'http://google-sheets-mcp-svc/mcp'},
							{name: 'google-workspace', url: 'http://google-workspace-mcp-svc/mcp'},
							// Second registration of the same server: a distinct aggregator session so one
							// person can authorize a second Google account in parallel (cf. gmail/gmail-2).
							{name: 'google-workspace-2', url: 'http://google-workspace-mcp-svc/mcp'},
							{name: 'starling-bank', url: 'http://starling-bank-mcp-svc/mcp'},
							{name: 'airtable', url: 'http://airtable-mcp-svc/mcp'},
							{name: 'openfoodfacts', url: 'http://openfoodfacts-mcp-svc/mcp'},
							{name: 'olio', url: 'http://olio-volunteer-mcp-svc/mcp'},
							{name: 'benepass', url: 'http://benepass-mcp-svc/mcp'},
							{name: 'barcode-scanner', url: 'http://barcode-scanner-mcp-svc/mcp'},
							{name: 'home-assistant', url: 'http://ha-mcp-svc/mcp'},
							{name: 'whatsapp', url: 'http://whatsapp-mcp-svc/mcp'},
							// Second registration of the same server: a distinct client id, so it
							// can be bound to a different mcp-auth-wrapper profile and therefore a
							// second WhatsApp account — the agent's own number rather than Adam's
							// (cf. gmail/gmail-2, though that works via per-session OAuth instead).
							{name: 'whatsapp-claube', url: 'http://whatsapp-mcp-svc/mcp'},
							{name: 'tunnel', url: 'http://mcp-local-tunnel-svc/mcp'},
							{name: 'slack', url: 'https://mcp.slack.com/mcp', clientId: '825862040501.10898174083287'},
							{name: 'posthog', url: 'https://mcp.posthog.com/mcp'},
						],
						// Dual-stack; the default 0.0.0.0 is IPv4-only
						host: '::',
						storage: '/app/data/mcp-aggregator.sqlite',
						issuerUrl: `https://mcp.${env.BASE_DOMAIN}`,
						secret: env.MCP_AGGREGATOR_SECRET,
					}),
				}],
				volumeMounts: [{
					name: 'mcp-data-volume',
					mountPath: '/app/data',
				}],
			}],
			volumes: [{
				name: 'mcp-data-volume',
				persistentVolumeClaim: {
					claimName: mcpAggregatorDataPvc.metadata.name,
				},
			}],
		},
		ingress: {host: `mcp.${env.BASE_DOMAIN}`, auth: false},
	},
	{
		// Serves the cluster's OIDC discovery documents (see
		// oidcDiscoveryConfigmap in storage.ts) so AWS IAM can federate against
		// service account tokens.
		name: 'oidc-discovery',
		targetPort: 80,
		spec: {
			initContainers: [{
				// Fetch the live JWKS from the apiserver, authenticated as this
				// app's service account (the built-in
				// system:service-account-issuer-discovery ClusterRole grants all
				// service accounts read access). A point-in-time copy rather than a
				// live proxy keeps the apiserver unreachable from the internet and
				// the public-facing nginx credential-free; the signing key only
				// rotates on cluster rebuild, which restarts this pod anyway.
				name: 'fetch-jwks',
				image: 'curlimages/curl:latest@sha256:3fb7e13e5d179a845c97d78204f3f1064d1907037f26a3ebf91710571151fd93',
				command: ['sh', '-c', 'curl -sSf --cacert /var/run/secrets/apiserver/ca.crt -H "Authorization: Bearer $(cat /var/run/secrets/apiserver/token)" https://kubernetes.default.svc/openid/v1/jwks -o /jwks/jwks'],
				volumeMounts: [
					{name: 'jwks', mountPath: '/jwks'},
					{name: 'apiserver-auth', mountPath: '/var/run/secrets/apiserver', readOnly: true},
				],
			}],
			containers: [{
				name: 'nginx',
				image: 'nginx:stable-alpine@sha256:0d3b80406a13a767339fbe2f41406d6c7da727ab89cf8fae399e81f780f814d1',
				volumeMounts: [
					{name: 'content', mountPath: '/data'},
					{name: 'jwks', mountPath: '/data/openid/v1'},
					{name: 'nginx-conf', mountPath: '/etc/nginx/conf.d'},
				],
			}],
			volumes: [
				{
					name: 'content',
					configMap: {
						name: oidcDiscoveryConfigmap.metadata.name,
						items: [
							{key: 'openid-configuration', path: '.well-known/openid-configuration'},
						],
					},
				},
				{name: 'jwks', emptyDir: {}},
				// Apiserver credentials for the init container only — the nginx
				// container never sees them.
				{
					name: 'apiserver-auth',
					projected: {
						sources: [
							{serviceAccountToken: {path: 'token', expirationSeconds: 600}},
							{configMap: {name: 'kube-root-ca.crt', items: [{key: 'ca.crt', path: 'ca.crt'}]}},
						],
					},
				},
				{
					name: 'nginx-conf',
					configMap: {
						name: oidcDiscoveryConfigmap.metadata.name,
						items: [{key: 'nginx.conf', path: 'default.conf'}],
					},
				},
			],
		},
		ingress: {host: `k8s-oidc.${env.BASE_DOMAIN}`, auth: false},
	},
	// Adam's personal agent: a long-running Claude Code session reachable over
	// WhatsApp. The image is a general-purpose sandbox carrying no source — the
	// PVC holds the git checkout it edits and pushes, plus its Claude Code
	// credential and session transcripts.
	//
	// First boot needs a shell — note the -deployment suffix that services.ts
	// appends, without which this is a confusing NotFound:
	// `kubectl exec -it deploy/personal-agent-deployment -- bash`, then `claude`
	// to authenticate. The entrypoint waits until that exists rather than
	// crash-looping, so an unauthenticated pod sits idle and says so.
	{
		name: 'personal-agent',
		targetPort: 4317,
		// Single replica on a RWO volume, and two Claude Code sessions sharing one
		// checkout would fight: replace, don't roll.
		strategy: {type: 'Recreate'},
		spec: {
			// The PVC mounts as root-owned by default; the container runs as root
			// so this is only about the files it creates staying readable.
			securityContext: {fsGroup: 0},
			containers: [{
				name: 'personal-agent',
				image: 'ghcr.io/domdomegg/personal-agent:latest',
				imagePullPolicy: 'Always',
				volumeMounts: [{
					name: 'personal-agent-data-volume',
					mountPath: '/home/agent',
				}],
			}],
			volumes: [{
				name: 'personal-agent-data-volume',
				persistentVolumeClaim: {
					claimName: personalAgentDataPvc.metadata.name,
				},
			}],
		},
		// The transcript viewer, behind the same auth as the other internal tools.
		ingress: {host: `agent.${env.BASE_DOMAIN}`, auth: true},
	},
];

type AppDefinition = {
	name: string;
	targetPort?: number;
	spec: core.v1.PodSpec;
	strategy?: appsTypes.v1.DeploymentStrategy;
	podAnnotations?: Record<string, pulumi.Input<string>>;
	ingress?: {host: string; auth: boolean};
	/** For apps that can't listen on IPv6, so Traefik doesn't route half their requests to a dead endpoint */
	ipv4Only?: boolean;
};
