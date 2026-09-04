import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import {provider} from './provider';
import {ingress} from './ingress';
import env from '../env/prod';

// Loop our own public hostname back through the ingress, inside the cluster.
//
// Publicly `*.${BASE_DOMAIN}` resolves to the Oracle IPv4 relay (A) and the node's
// IPv6 via ddclient (AAAA). In-cluster clients that touch a public hostname — the
// aggregator refreshing upstream tokens at a wrapper's advertised /token, wrappers
// validating against oidc.*, call-mcp inside personal-agent — were hairpinning out
// through the relay and back. On 2026-08-29 the relay path died after a NIC flap and
// every such call failed within an hour as tokens expired, taking the MCP stack with it.
//
// k3s CoreDNS imports `/etc/coredns/custom/*.override` into its main server block,
// so this rewrite runs ahead of the kubernetes plugin: any name under BASE_DOMAIN is
// answered as the ingress-nginx controller Service. Pods then reach nginx directly
// on its cluster IP — same Host, TLS and routing rules as from outside, but no
// dependence on the relay, the router's pinholes or what ddclient last published.
// Nothing is pinned: the Service name follows the Helm release, the address follows
// the Service.
const domain = env.BASE_DOMAIN.replace(/\./g, '\\.');
// The chart names its controller Service `<fullname>-controller`, and fullname is the
// release name when that already contains the chart name (it does: `ingress-nginx-…`).
const controllerService = pulumi.interpolate`${ingress.status.name}-controller.${ingress.namespace}.svc.cluster.local`;

export const corednsCustomConfigmap = new k8s.core.v1.ConfigMap('coredns-custom', {
	metadata: {
		name: 'coredns-custom',
		namespace: 'kube-system',
	},
	data: {
		'home-domain.override': pulumi.interpolate`rewrite stop {
  name regex (.*\\.)?${domain}\\.$ ${controllerService}.
  answer auto
}
`,
	},
}, {provider});
