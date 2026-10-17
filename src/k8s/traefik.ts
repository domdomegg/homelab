import * as k8s from '@pulumi/kubernetes';
import {provider} from './provider';

const namespace = new k8s.core.v1.Namespace('traefik-namespace', {
	metadata: {
		name: 'traefik',
	},
}, {provider});

// The chart's CRDs (Middleware etc.) are installed on first install only: Helm never
// upgrades them. If a chart bump needs newer CRDs, apply them by hand:
// `helm show crds traefik --repo https://traefik.github.io/charts --version <v> | kubectl apply --server-side -f -`
// (The separate traefik-crds chart would avoid this, but its release is over Helm's 1MB limit.)
export const traefik = new k8s.helm.v3.Release('traefik', {
	chart: 'traefik',
	// renovate: datasource=helm depName=traefik registryUrl=https://traefik.github.io/charts
	version: '41.7.1',
	repositoryOpts: {
		repo: 'https://traefik.github.io/charts',
	},
	namespace: namespace.metadata.name,
	values: {
		ingressClass: {
			name: 'traefik',
			isDefaultClass: true,
		},
		ports: {
			web: {
				http: {
					redirections: {
						entryPoint: {to: 'websecure', scheme: 'https', permanent: true},
					},
				},
				// Leaves /.well-known/acme-challenge/ out of the redirect above, so
				// cert-manager's HTTP01 solver Ingresses are served over plain HTTP
				allowACMEByPass: true,
				transport: {
					// The 60s default caps the whole request, cutting off websockets
					// (Home Assistant, tunnel.mcp.*), SSE streams (MCP) and slow uploads
					respondingTimeouts: {readTimeout: 0},
				},
			},
			websecure: {
				http: {
					// See retry below
					middlewares: ['traefik-retry@kubernetescrd'],
				},
				transport: {
					respondingTimeouts: {readTimeout: 0},
				},
			},
		},
		// klipper (k3s servicelb) binds this to the node's 80/443. The IPv4 relay forwards
		// raw TCP to the node's IPv6, so IPv6 is all that's needed.
		service: {
			spec: {
				ipFamilies: ['IPv6'],
			},
		},
		api: {
			dashboard: false,
		},
	},
}, {provider});

// Traefik balances across every endpoint of a dual-stack Service, so for apps that only
// bind IPv4 (e.g. vouch-proxy) half the connects are refused. Retry those on the next
// endpoint. Only failed connects are retried, never a request that reached the app.
new k8s.apiextensions.CustomResource('traefik-retry', {
	apiVersion: 'traefik.io/v1alpha1',
	kind: 'Middleware',
	metadata: {
		name: 'retry',
		namespace: namespace.metadata.name,
	},
	spec: {
		retry: {attempts: 3},
	},
}, {provider, dependsOn: [traefik]});
