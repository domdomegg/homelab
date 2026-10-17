import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import {apps} from './appDefinitions';
import {provider} from './provider';
import {traefik} from './traefik';
import env from '../env/prod';

apps.forEach((app) => {
	const labels = {app: app.name};

	// Every app runs as its own service account so there's always a distinct,
	// ready-made identity to hang RBAC grants, cloud federation trust policies,
	// etc. off — rather than sharing 'default'.
	const serviceAccount = new k8s.core.v1.ServiceAccount(`${app.name}-sa`, {
		metadata: {
			name: app.name,
		},
	}, {provider});

	const deployment = new k8s.apps.v1.Deployment(`${app.name}-deployment`, {
		metadata: {
			name: `${app.name}-deployment`,
		},
		spec: {
			selector: {matchLabels: labels},
			replicas: 1,
			...(app.strategy ? {strategy: app.strategy} : {}),
			template: {
				metadata: {labels},
				spec: {
					serviceAccountName: serviceAccount.metadata.name,
					// Identity without credentials: don't mount the k8s API token by
					// default. Apps that need a token opt in, e.g. via a projected
					// serviceAccountToken volume (unaffected by this setting) like oidc-discovery.
					automountServiceAccountToken: false,
					...app.spec,
				},
			},
		},
	}, {provider});

	if (app.targetPort) {
		const service = new k8s.core.v1.Service(`${app.name}-svc`, {
			spec: {
				type: 'ClusterIP',
				selector: labels,
				ipFamilyPolicy: 'RequireDualStack',
				ports: [{
					name: 'default',
					port: 80,
					targetPort: app.targetPort,
				}],
			},
			metadata: {
				name: `${app.name}-svc`,
			},
		}, {provider, dependsOn: [deployment]});

		if (app.ingress) {
			// vouch-proxy only answers 401 or 200, so on a 401 Traefik itself sends the browser
			// to vouch's login. That URL is static, so after logging in you land on the app's
			// root rather than the exact page you asked for.
			const auth = app.ingress.auth
				? new k8s.apiextensions.CustomResource(`${app.name}-auth`, {
					apiVersion: 'traefik.io/v1alpha1',
					kind: 'Middleware',
					metadata: {
						name: `${app.name}-auth`,
					},
					spec: {
						forwardAuth: {
							// Server-side subrequest, so keep it in-cluster. Any *public* vouch
							// hostname sends every auth check back out over the home uplink and
							// in again via NAT loopback (v6) or the Oracle relay (v4), paying a
							// TLS handshake on a hop that never leaves the node -- which made
							// authenticated services hang for up to 60s whenever that path
							// blipped. authSigninURL must stay public: it's a browser
							// redirect, not a subrequest. No port here -- the svc listens on 80.
							address: 'http://vouch-proxy-svc.default.svc.cluster.local/validate',
							authSigninURL: `https://vouch.${env.BASE_DOMAIN}/login?url=https://${app.ingress.host}/`,
						},
					},
				}, {provider, dependsOn: [traefik]})
				: undefined;

			new k8s.networking.v1.Ingress(`${app.name}-ingress`, {
				metadata: {
					name: `${app.name}-ingress`,
					annotations: {
						'cert-manager.io/cluster-issuer': 'cert-manager-issuer',
						// HTTPS only: the web entrypoint redirects everything but ACME challenges
						'traefik.ingress.kubernetes.io/router.entrypoints': 'websecure',
						...(auth
							? {'traefik.ingress.kubernetes.io/router.middlewares': pulumi.interpolate`${auth.metadata.namespace}-${auth.metadata.name}@kubernetescrd`}
							: {}),
					},
				},
				spec: {
					ingressClassName: 'traefik',
					tls: [{
						hosts: [app.ingress.host],
						secretName: `${app.name}-certificate`,
					}],
					rules: [app.ingress.host].map((host) => ({
						host,
						http: {
							paths: [{
								path: '/',
								pathType: 'Prefix',
								backend: {
									service: {
										name: service.metadata.name,
										port: {
											name: 'default',
										},
									},
								},
							}],
						},
					})),
				},
			}, {provider, dependsOn: [traefik]});
		}
	}
});
