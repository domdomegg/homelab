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
