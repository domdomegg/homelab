import { core } from '@pulumi/kubernetes/types/input';
import {
  haDataPvc, mosquittoConfigmap, ddclientConfigmap, zigbee2mqttDataPvc, zigbee2mqttConfigmap, esphomeDataPvc,
} from './storage';
import env from '../env/prod';

export const apps: AppDefinition[] = [
  {
    name: 'nginx',
    targetPort: 80,
    spec: {
      containers: [{
        name: 'nginx',
        image: 'nginx',
      }],
    },
    ingress: { host: `nginx.${env.BASE_DOMAIN}`, auth: true },
  },
  {
    name: 'ha',
    targetPort: 8123,
    spec: {
      containers: [{
        name: 'ha',
        image: 'ghcr.io/home-assistant/home-assistant:stable@sha256:408a5a63e3e9a89ceb6ecd98345e54c86073314b4d94e217cd54f7208307406d',
        // Necessary to access the Bluetooth
        securityContext: {
          privileged: true,
        },
        volumeMounts: [
          {
            name: 'ha-data-volume',
            mountPath: '/config',
          },
          {
            name: 'ha-dbus',
            mountPath: '/run/dbus',
            readOnly: true,
          },
        ],
      }],
      volumes: [
        {
          name: 'ha-data-volume',
          persistentVolumeClaim: {
            claimName: haDataPvc.metadata.name,
          },
        },
        // For Bluetooth integration
        {
          name: 'ha-dbus',
          hostPath: {
            path: '/run/dbus',
          },
        },
      ],
    },
    ingress: { host: env.BASE_DOMAIN, auth: false },
  },
  {
    name: 'mosquitto',
    targetPort: 1883,
    spec: {
      containers: [{
        name: 'eclipse-mosquitto',
        image: 'eclipse-mosquitto:latest@sha256:090d745b6435d10a31acb82eee999ec36a2d7f416cc4f578c0a298c42af2ea14',
        volumeMounts: [
          {
            name: 'mosquitto-configmap-volume',
            mountPath: '/mosquitto/config/mosquitto.conf',
            subPath: 'mosquitto.conf',
          },
        ],
      }],
      volumes: [{
        name: 'mosquitto-configmap-volume',
        configMap: {
          name: mosquittoConfigmap.metadata.name,
        },
      }],
    },
  },
  {
    name: 'zigbee2mqtt',
    targetPort: 8080,
    spec: {
      containers: [{
        name: 'zigbee2mqtt',
        image: 'koenkk/zigbee2mqtt:latest@sha256:8643f5d454fb2209a1ce765cb0726b57b92e38ac293af95f068760473af4cf5d',
        // Necessary to access the USB Zigbee stick
        securityContext: {
          privileged: true,
        },
        volumeMounts: [
          {
            name: 'zigbee2mqtt-data-volume',
            mountPath: '/app/data',
          },
          {
            name: 'zigbee2mqtt-configmap-volume',
            mountPath: '/app/data/configuration.yaml',
            subPath: 'configuration.yaml',
          },
          // Access to the USB Zigbee stick
          {
            name: 'zigbee2mqtt-usb-volume',
            mountPath: '/dev/ttyUSB0',
          },
        ],
      }],
      volumes: [
        {
          name: 'zigbee2mqtt-data-volume',
          persistentVolumeClaim: {
            claimName: zigbee2mqttDataPvc.metadata.name,
          },
        },
        {
          name: 'zigbee2mqtt-configmap-volume',
          configMap: {
            name: zigbee2mqttConfigmap.metadata.name,
          },
        },
        {
          name: 'zigbee2mqtt-udev-volume',
          hostPath: {
            path: '/run/udev',
          },
        },
        {
          name: 'zigbee2mqtt-usb-volume',
          hostPath: {
            path: '/dev/ttyUSB0',
          },
        },
      ],
    },
    ingress: { host: `z2m.${env.BASE_DOMAIN}`, auth: true },
  },
  {
    name: 'ddclient',
    spec: {
      containers: [{
        name: 'ddclient',
        image: 'linuxserver/ddclient:latest@sha256:cc4479aafee392148b2a68d2a4d5d4fb16c6748695dbb7f700e8ec7ff5468c73',
        volumeMounts: [
          {
            name: 'ddclient-configmap-volume',
            mountPath: '/defaults/ddclient.conf',
            subPath: 'ddclient.conf',
          },
        ],
      }],
      volumes: [
        {
          name: 'ddclient-configmap-volume',
          configMap: {
            name: ddclientConfigmap.metadata.name,
          },
        },
      ],
    },
  },
  {
    name: 'vouch-proxy',
    targetPort: 9090,
    spec: {
      containers: [{
        name: 'vouch-proxy',
        image: 'quay.io/vouch/vouch-proxy:latest@sha256:2e6b58ad8c8bdcee4aa6b98c8d6d02f6c3e6aca6fc35a016054e5d867ce70104',
        env: [{
          name: 'VOUCH_ALLOWALLUSERS',
          value: 'true',
        }, {
          name: 'VOUCH_COOKIE_DOMAIN',
          value: env.BASE_DOMAIN,
        }, {
          name: 'VOUCH_LISTEN',
          value: '0.0.0.0',
        }, {
          name: 'OAUTH_PROVIDER',
          value: 'homeassistant',
        }, {
          name: 'OAUTH_CLIENT_ID',
          value: `https://vouch.${env.BASE_DOMAIN}`,
        }, {
          name: 'OAUTH_CALLBACK_URL',
          value: `https://vouch.${env.BASE_DOMAIN}/auth`,
        }, {
          name: 'OAUTH_AUTH_URL',
          value: `https://${env.BASE_DOMAIN}/auth/authorize`,
        }, {
          name: 'OAUTH_TOKEN_URL',
          value: `https://${env.BASE_DOMAIN}/auth/token`,
        }],
      }],
    },
    ingress: { host: `vouch.${env.BASE_DOMAIN}`, auth: false },
  },
  {
    name: 'esphome',
    targetPort: 6052,
    spec: {
      containers: [{
        name: 'esphome',
        image: 'ghcr.io/esphome/esphome:latest@sha256:a8b53d9732326fe2e7da75c48aaa612787c2695ff2b889c52c41cfce65f3a40a',
        env: [{
          name: 'ESPHOME_DASHBOARD_USE_PING',
          value: 'true',
        }],
        volumeMounts: [
          {
            name: 'esphome-data-volume',
            mountPath: '/config',
          },
        ],
      }],
      volumes: [
        {
          name: 'esphome-data-volume',
          persistentVolumeClaim: {
            claimName: esphomeDataPvc.metadata.name,
          },
        },
      ],
    },
    ingress: { host: `esphome.${env.BASE_DOMAIN}`, auth: true },
  },
];

interface AppDefinition {
  name: string,
  targetPort?: number,
  spec: core.v1.PodSpec,
  ingress?: { host: string, auth: boolean },
}
