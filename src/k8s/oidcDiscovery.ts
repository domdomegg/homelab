import * as k8s from '@pulumi/kubernetes';
import { provider } from './provider';
import { ingress } from './ingress';
import env from '../env/prod';

// Serve the cluster's OIDC discovery documents publicly so AWS IAM can
// federate against service account tokens (keyless auth for workloads, e.g.
// the adamcon app sending email via SES).
//
// We serve STATIC copies of the discovery document and JWKS (public keys
// only) from nginx rather than proxying the apiserver, because k3s runs with
// --anonymous-auth=false and this keeps the apiserver entirely unexposed.
//
// The JWKS below only changes if the cluster's service account signing key
// rotates (in practice: on cluster rebuild). Regenerate it with:
//   kubectl get --raw /openid/v1/jwks
//
// Requires the k3s apiserver to issue tokens with the public issuer:
//   /etc/rancher/k3s/config.yaml:
//     kube-apiserver-arg:
//       - service-account-issuer=https://k8s-oidc.<BASE_DOMAIN>
//       - service-account-issuer=https://kubernetes.default.svc.cluster.local

const host = `k8s-oidc.${env.BASE_DOMAIN}`;

// kubectl get --raw /openid/v1/jwks (fetched 2026-07-02)
const jwks = '{"keys":[{"use":"sig","kty":"RSA","kid":"jtdjbXhVrlw-OSK0Nurz8Jyjzlg-axoxLhOAvmnO2xA","alg":"RS256","n":"pmBPzqRdRWeug5Ndys52aOuKebbTi2WxqOvAqj161oBUlgB3_naVYwPnSQSdFY1BM816l2WdBjMVwCgP2CoOqXlhKQkD4aVXlzMMI260tSAW0N5AOh4uf9jbsxWvW6Af1g3xT7r5mmpsbxNsa1pm8pve4UohxsR80ouGlT79fdOy64Z8SyYK8LiObwpdsMG0tGMlUKiRNumu70CuJz6nJ2WY-XpbZC0s02WVHmDmKtecjOK-JcUjkRua-dpTlE6Plk2CzVZAg-PPMd1DwVw-tn_B8U1NBFCh088fDn39bWCG72XTv3mJ8p8i6OrNeALtokG-A5JUSWpISM11b2nvyw","e":"AQAB"}]}';

const openidConfiguration = JSON.stringify({
  issuer: `https://${host}`,
  jwks_uri: `https://${host}/openid/v1/jwks`,
  response_types_supported: ['id_token'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
});

const nginxConf = `server {
  listen 80;
  listen [::]:80;
  default_type application/json;
  root /data;
}
`;

const configMap = new k8s.core.v1.ConfigMap('oidc-discovery-config', {
  metadata: {
    name: 'oidc-discovery-config',
  },
  data: {
    'openid-configuration': openidConfiguration,
    jwks,
    'nginx.conf': nginxConf,
  },
}, { provider });

const labels = { app: 'oidc-discovery' };
const deployment = new k8s.apps.v1.Deployment('oidc-discovery-deployment', {
  metadata: {
    name: 'oidc-discovery-deployment',
  },
  spec: {
    selector: { matchLabels: labels },
    replicas: 1,
    template: {
      metadata: { labels },
      spec: {
        containers: [{
          name: 'nginx',
          image: 'nginx:1.29-alpine',
          ports: [{ containerPort: 80 }],
          volumeMounts: [
            { name: 'content', mountPath: '/data' },
            { name: 'nginx-conf', mountPath: '/etc/nginx/conf.d' },
          ],
        }],
        volumes: [
          {
            name: 'content',
            configMap: {
              name: configMap.metadata.name,
              items: [
                { key: 'openid-configuration', path: '.well-known/openid-configuration' },
                { key: 'jwks', path: 'openid/v1/jwks' },
              ],
            },
          },
          {
            name: 'nginx-conf',
            configMap: {
              name: configMap.metadata.name,
              items: [{ key: 'nginx.conf', path: 'default.conf' }],
            },
          },
        ],
      },
    },
  },
}, { provider });

const service = new k8s.core.v1.Service('oidc-discovery-svc', {
  metadata: {
    name: 'oidc-discovery-svc',
  },
  spec: {
    type: 'ClusterIP',
    selector: labels,
    ipFamilyPolicy: 'RequireDualStack',
    ports: [{ name: 'default', port: 80, targetPort: 80 }],
  },
}, { provider, dependsOn: [deployment] });

new k8s.networking.v1.Ingress('oidc-discovery-ingress', {
  metadata: {
    name: 'oidc-discovery-ingress',
    annotations: {
      'kubernetes.io/ingress.class': 'nginx',
      'cert-manager.io/cluster-issuer': 'cert-manager-issuer',
    },
  },
  spec: {
    tls: [{
      hosts: [host],
      secretName: 'oidc-discovery-certificate',
    }],
    rules: [{
      host,
      http: {
        paths: [{
          path: '/',
          pathType: 'Prefix',
          backend: {
            service: {
              name: service.metadata.name,
              port: { name: 'default' },
            },
          },
        }],
      },
    }],
  },
}, { provider, dependsOn: [ingress] });
