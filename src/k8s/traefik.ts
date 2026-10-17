import * as k8s from '@pulumi/kubernetes';
import {provider} from './provider';
import {ingress} from './ingress';

// Traefik replaces ingress-nginx (retired upstream). Its Kubernetes Ingress NGINX
// provider reads the same Ingress objects and nginx.ingress.kubernetes.io/*
// annotations, so the Ingresses in services.ts work unchanged under either controller.
//
// Currently running alongside ingress-nginx on a ClusterIP only, so it can be tested
// in-cluster (see README) before it takes over the node's 80/443.

const namespace = new k8s.core.v1.Namespace('traefik-namespace', {
	metadata: {
		name: 'traefik',
	},
}, {provider});

// Shared by both controllers while they run side by side: ingress-nginx and Traefik's
// NGINX provider both select IngressClasses by this controller value. Owned here rather
// than by the ingress-nginx chart so it survives that chart's removal. Our own Ingresses
// use the kubernetes.io/ingress.class annotation, which needs no IngressClass object;
// this is for cert-manager's solver Ingresses (ingressClassName) and as the default.
// Created after the ingress-nginx chart has dropped its own IngressClass of the same name.
export const ingressClass = new k8s.networking.v1.IngressClass('nginx-ingress-class', {
	metadata: {
		name: 'nginx',
		annotations: {
			'ingressclass.kubernetes.io/is-default-class': 'true',
		},
	},
	spec: {
		controller: 'k8s.io/ingress-nginx',
	},
}, {provider, dependsOn: [ingress]});

export const traefik = new k8s.helm.v3.Release('traefik', {
	chart: 'traefik',
	// renovate: datasource=helm depName=traefik registryUrl=https://traefik.github.io/charts
	version: '41.7.1',
	repositoryOpts: {
		repo: 'https://traefik.github.io/charts',
	},
	namespace: namespace.metadata.name,
	// Only for the IngressRoute etc. CRD provider, which we don't use
	skipCrds: true,
	values: {
		providers: {
			kubernetesIngressNGINX: {
				enabled: true,
				// The 60s default (as in nginx) drops idle websockets (HA, tunnel.mcp.*) and SSE streams
				proxyReadTimeout: 3600,
				proxySendTimeout: 3600,
			},
			// Would otherwise route the same Ingresses a second time
			kubernetesIngress: {enabled: false},
			kubernetesCRD: {enabled: false},
		},
		// The chart's IngressClass is for the plain Ingress provider; see ingressClass above
		ingressClass: {enabled: false},
		ports: {
			// No redirect here: the NGINX provider already redirects HTTP→HTTPS for any Ingress
			// with a tls section (like nginx's ssl-redirect), and cert-manager's HTTP01 solver
			// Ingresses have none, so challenges are still served over plain HTTP.
			web: {
				transport: {
					// The 60s default caps the whole request, cutting off websockets, SSE and slow uploads
					respondingTimeouts: {readTimeout: 0},
				},
			},
			websecure: {
				transport: {
					respondingTimeouts: {readTimeout: 0},
				},
			},
		},
		service: {
			spec: {
				type: 'ClusterIP',
				ipFamilyPolicy: 'PreferDualStack',
				ipFamilies: ['IPv6', 'IPv4'],
			},
		},
		api: {
			dashboard: false,
		},
	},
}, {provider});
