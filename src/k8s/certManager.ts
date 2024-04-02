import * as k8s from '@pulumi/kubernetes';
import { provider } from './provider';
import { ingress } from './ingress';

const namespace = new k8s.core.v1.Namespace('cert-manager-namespace', {
  metadata: {
    name: 'cert-manager',
  },
}, { provider });

const helmRelease = new k8s.helm.v3.Release('cert-manager', {
  chart: 'cert-manager',
  repositoryOpts: {
    repo: 'https://charts.jetstack.io',
  },
  namespace: namespace.metadata.name,
  values: {
    installCRDs: true,
  },
}, { provider });

new k8s.apiextensions.CustomResource('cert-manager-issuer', {
  apiVersion: 'cert-manager.io/v1',
  kind: 'ClusterIssuer',
  metadata: {
    name: 'cert-manager-issuer',
    namespace: 'cert-manager',
  },
  spec: {
    acme: {
      email: 'domdomegg+letsencrypt@gmail.com',
      server: 'https://acme-v02.api.letsencrypt.org/directory',
      // server: 'https://acme-staging-v02.api.letsencrypt.org/directory',
      privateKeySecretRef: {
        name: 'cert-manager-issuer-account-key',
      },
      solvers: [{
        http01: {
          ingress: {
            ingressClassName: 'nginx',
          },
        },
      }],
    },
  },
}, { provider, dependsOn: [helmRelease, ingress] });
