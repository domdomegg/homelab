import * as k8s from '@pulumi/kubernetes';
import {provider} from './provider';
import env from '../env/prod';

// Split-horizon DNS for our own public hostname inside the cluster.
//
// Publicly `*.${BASE_DOMAIN}` resolves to the Oracle IPv4 relay (A) and the node's
// IPv6 via ddclient (AAAA). In-cluster clients that touch a public hostname — the
// aggregator refreshing upstream tokens at a wrapper's advertised /token, wrappers
// validating against oidc.*, call-mcp inside personal-agent — were hairpinning out
// through the relay. On 2026-08-29 the relay path died after a NIC flap and every
// such call failed within an hour as tokens expired, taking the whole MCP stack with it.
//
// k3s CoreDNS imports `/etc/coredns/custom/*.server` from this ConfigMap, so this
// answers AAAA with the ingress-nginx LoadBalancer IP (the static k3s node IP) and A
// with NODATA: in-cluster traffic goes straight to ingress-nginx, independent of the
// relay, the router's pinholes and whatever ddclient last published.
const ingressIpv6 = '2a01:4b00:bd15:c800::3e6';

export const corednsCustomConfigmap = new k8s.core.v1.ConfigMap('coredns-custom', {
	metadata: {
		name: 'coredns-custom',
		namespace: 'kube-system',
	},
	data: {
		'home-domain.server': `${env.BASE_DOMAIN}:53 {
  errors
  template IN AAAA ${env.BASE_DOMAIN} {
    answer "{{ .Name }} 60 IN AAAA ${ingressIpv6}"
    fallthrough
  }
  template IN A ${env.BASE_DOMAIN} {
    rcode NOERROR
    fallthrough
  }
  forward . /etc/resolv.conf
}
`,
	},
}, {provider});
