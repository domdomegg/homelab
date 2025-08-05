import * as k8s from '@pulumi/kubernetes';
import { provider } from './provider';

const namespace = new k8s.core.v1.Namespace('ingress-nginx-namespace', {
  metadata: {
    name: 'ingress-nginx',
  },
}, { provider });

export const ingress = new k8s.helm.v3.Release('ingress-nginx', {
  chart: 'ingress-nginx',
  repositoryOpts: {
    repo: 'https://kubernetes.github.io/ingress-nginx',
  },
  namespace: namespace.metadata.name,
  values: {
    controller: {
      config: {
        'force-ssl-redirect': 'true',

        // Disable strict path validation, to work around a bug in ingress-nginx
        // https://cert-manager.io/docs/releases/release-notes/release-notes-1.18/#acme-http01-challenge-paths-now-use-pathtype-exact-in-ingress-routes
        // https://github.com/kubernetes/ingress-nginx/issues/11176
        'strict-validate-path-type': false,
      },
      ingressClassResource: {
        default: 'true',
      },
      service: {
        ipFamilies: ['IPv6'],
      },
    },
  },
}, { provider });
