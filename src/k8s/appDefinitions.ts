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
        image: 'ghcr.io/home-assistant/home-assistant:stable@sha256:871f84a00db8d05856a70ee3761b138a8e91eb108d61f2fa176e7eeadb5eda03',
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
        image: 'eclipse-mosquitto:latest@sha256:deae95623b9d5c6ca5e264380629db53b992106d436b56d42f7c8df46b41b96f',
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
        image: 'koenkk/zigbee2mqtt:latest@sha256:6105a3a01a66bbfb98909a7c309d0707ec7b41728ac15d399747077225231545',
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
        image: 'linuxserver/ddclient:latest@sha256:6a73ba73b92aa3e238639225c706966d271e50a798c39435e737c20db8b20213',
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
        image: 'quay.io/vouch/vouch-proxy:latest@sha256:b1f82c00eb5b154aeb9f58a7c846a73ff9ae683fe4e51953f8fa188baa50006f',
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
        image: 'ghcr.io/esphome/esphome:latest@sha256:9874fb1af9aac33595881c9ae3b6caa3a6424a09589f3f35368da54abfde7fa6',
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
