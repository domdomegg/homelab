import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import {apps} from './appDefinitions';
import {provider} from './provider';
import {traefik} from './traefik';

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
				...(app.ipv4Only
					? {ipFamilyPolicy: 'SingleStack', ipFamilies: ['IPv4']}
					: {ipFamilyPolicy: 'RequireDualStack'}),
				ports: [{
					name: 'default',
					port: 80,
					targetPort: app.targetPort,
				}],
			},
			metadata: {
				name: `${app.name}-svc`,
			},
		}, {
			provider,
			dependsOn: [deployment],
			// A Service's primary IP family can't be changed in place
			replaceOnChanges: ['spec.ipFamilies', 'spec.ipFamilyPolicy'],
			deleteBeforeReplace: true,
		});

		if (app.ingress) {
			const auth = app.ingress.auth
				? new k8s.apiextensions.CustomResource(`${app.name}-auth`, {
					apiVersion: 'traefik.io/v1alpha1',
					kind: 'Middleware',
					metadata: {
						name: `${app.name}-auth`,
					},
					spec: {
						forwardAuth: {
							// In-cluster: via the public hostname, every auth check hairpins out
							// through NAT or the relay, which made authenticated apps hang for up
							// to 60s whenever that path blipped.
							address: 'http://oauth2-proxy-svc.default.svc.cluster.local/',
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
