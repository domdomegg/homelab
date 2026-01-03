import { core } from '@pulumi/kubernetes/types/input';
import {
  haDataPvc, mosquittoConfigmap, ddclientConfigmap, zigbee2mqttDataPvc, esphomeDataPvc, piperDataPvc, whisperDataPvc, puregymGoogleWalletDataPvc,
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
        image: 'ghcr.io/home-assistant/home-assistant:stable@sha256:75ef6851d2e48d366764cdb6b569b7ad8be77dcc8e0d1b9aa508ac90e42d4c58',
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
        image: 'eclipse-mosquitto:latest@sha256:077fe4ff4c49df1e860c98335c77dda08360629e0e2a718147027e4db3eace9d',
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
        image: 'koenkk/zigbee2mqtt:latest@sha256:163e7351430a95d550d5b1bb958527edc1eff115eb013ca627f3545a192e853f',
        // Necessary to access the USB Zigbee stick
        securityContext: {
          privileged: true,
        },
        volumeMounts: [
          {
            name: 'zigbee2mqtt-data-volume',
            mountPath: '/app/data',
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
        image: 'linuxserver/ddclient:latest@sha256:cf9c8c2ba0397dc689afd2f438b94d1ff7e5ff54ed4f00bcab43b04fb35fa462',
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
        image: 'ghcr.io/esphome/esphome:latest@sha256:a7915def0a60c76506db766b7b733760f09b47ab6a511d5052a6d38bc3f424e3',
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
  {
    name: 'whisper',
    targetPort: 10300,
    spec: {
      containers: [{
        name: 'whisper',
        image: 'rhasspy/wyoming-whisper:latest@sha256:995b37523bc422f4f7649e50ccded97a5b9bf6d1d0420591183a778dd5d7d3f2',
        args: ['--stt-library', 'sherpa', '--model', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8', '--language', 'en'],
        volumeMounts: [
          {
            name: 'whisper-data-volume',
            mountPath: '/data',
          },
        ],
      }],
      volumes: [
        {
          name: 'whisper-data-volume',
          persistentVolumeClaim: {
            claimName: whisperDataPvc.metadata.name,
          },
        },
      ],
    },
  },
  {
    name: 'piper',
    targetPort: 10200,
    spec: {
      containers: [{
        name: 'piper',
        image: 'rhasspy/wyoming-piper',
        args: ['--voice', 'en_GB-jenny_dioco-medium', '--length-scale', '0.6'],
        volumeMounts: [
          {
            name: 'piper-data-volume',
            mountPath: '/data',
          },
        ],
      }],
      volumes: [
        {
          name: 'piper-data-volume',
          persistentVolumeClaim: {
            claimName: piperDataPvc.metadata.name,
          },
        },
      ],
    },
  },
  {
    name: 'puregym-google-wallet',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'puregym-google-wallet',
        image: 'ghcr.io/domdomegg/puregym-google-wallet:latest',
        env: [{
          name: 'GOOGLE_SERVICE_ACCOUNT_JSON',
          value: env.GOOGLE_SERVICE_ACCOUNT_JSON,
        }, {
          name: 'GOOGLE_WALLET_ISSUER_ID',
          value: env.GOOGLE_WALLET_ISSUER_ID,
        }],
        volumeMounts: [
          {
            name: 'puregym-google-wallet-data-volume',
            mountPath: '/app/data',
          },
        ],
      }],
      volumes: [
        {
          name: 'puregym-google-wallet-data-volume',
          persistentVolumeClaim: {
            claimName: puregymGoogleWalletDataPvc.metadata.name,
          },
        },
      ],
    },
    ingress: { host: `puregym.${env.BASE_DOMAIN}`, auth: false },
  },
];

interface AppDefinition {
  name: string,
  targetPort?: number,
  spec: core.v1.PodSpec,
  ingress?: { host: string, auth: boolean },
}
