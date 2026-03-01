import * as k8s from '@pulumi/kubernetes';
import { apps } from './appDefinitions';
import { provider } from './provider';
import { ingress } from './ingress';
import env from '../env/prod';

apps.forEach((app) => {
  const labels = { app: app.name };
  const deployment = new k8s.apps.v1.Deployment(`${app.name}-deployment`, {
    metadata: {
      name: `${app.name}-deployment`,
    },
    spec: {
      selector: { matchLabels: labels },
      replicas: 1,
      template: {
        metadata: { labels },
        spec: app.spec,
      },
    },
  }, { provider });

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
    }, { provider, dependsOn: [deployment] });

    if (app.ingress) {
      new k8s.networking.v1.Ingress(`${app.name}-ingress`, {
        metadata: {
          name: `${app.name}-ingress`,
          annotations: {
            'kubernetes.io/ingress.class': 'nginx',
            'cert-manager.io/cluster-issuer': 'cert-manager-issuer',
            ...(app.ingress.auth ? {
              'nginx.ingress.kubernetes.io/auth-signin': `https://vouch.${env.BASE_DOMAIN}/login?url=$scheme://$http_host$request_uri`,
              'nginx.ingress.kubernetes.io/auth-url': `https://vouch.${env.BASE_DOMAIN}/validate`,
            } : {}),
          },
        },
        spec: {
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
      }, { provider, dependsOn: [ingress] });
    }
  }
});
