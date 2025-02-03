import * as k8s from '@pulumi/kubernetes';
import { provider } from './provider';
import env from '../env/prod';

export const haDataPvc = new k8s.core.v1.PersistentVolumeClaim('ha-data-pvc', {
  metadata: {
    name: 'ha-data-pvc',
    annotations: {
      'pulumi.com/skipAwait': 'true',
    },
  },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: {
      requests: {
        storage: '50Gi',
      },
    },
  },
}, { provider, replaceOnChanges: ['*'], deleteBeforeReplace: true });

export const haConfigmap = new k8s.core.v1.ConfigMap('ha-configmap', {
  metadata: {
    name: 'ha-configmap',
  },
  data: {
    // Keep DEFAULT CONFIG section up to date with https://github.com/home-assistant/core/blob/master/homeassistant/config.py#L89
    'configuration.yaml': `# This file is managed from K8s

### DEFAULT CONFIG ###

# Loads default set of integrations. Do not remove.
default_config:

# Load frontend themes from the themes folder
frontend:
  themes: !include_dir_merge_named themes

automation: !include automations.yaml
script: !include scripts.yaml
scene: !include scenes.yaml

### CUSTOM CONFIG ###

# Allow proxied connections because this sits behind an ingress controller
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 0.0.0.0/0
    - ::/0

# Set up Alexa integration
# https://www.home-assistant.io/integrations/alexa.smart_home/
alexa:
  smart_home:
    filter:
      include_entity_globs:
        - "light.*_lights"
`,
  },
}, { provider });

export const mosquittoConfigmap = new k8s.core.v1.ConfigMap('mosquitto-configmap', {
  metadata: {
    name: 'mosquitto-configmap',
  },
  data: {
    'mosquitto.conf': `# This file is managed from K8s
persistence true
persistence_location /mosquitto/data/
allow_anonymous true
listener 1883 0.0.0.0
listener 1883 ::1
`,
  },
}, { provider });

export const zigbee2mqttDataPvc = new k8s.core.v1.PersistentVolumeClaim('zigbee2mqtt-data-pvc', {
  metadata: {
    name: 'zigbee2mqtt-data-pvc',
    annotations: {
      'pulumi.com/skipAwait': 'true',
    },
  },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: {
      requests: {
        storage: '100Mi',
      },
    },
  },
}, { provider, replaceOnChanges: ['*'], deleteBeforeReplace: true });

export const zigbee2mqttConfigmap = new k8s.core.v1.ConfigMap('zigbee2mqtt-configmap', {
  metadata: {
    name: 'zigbee2mqtt-configmap',
  },
  data: {
    // Keep config up to date with https://github.com/Koenkk/zigbee2mqtt/blob/master/data/configuration.yaml
    'configuration.yaml': `# This file is managed from K8s

# Home Assistant integration (MQTT discovery)
# https://www.zigbee2mqtt.io/guide/usage/integrations/home_assistant.html
homeassistant: true

# Only enable joining when manually pairing - not all the time
# See https://www.zigbee2mqtt.io/guide/usage/pairing_devices.html
permit_join: false

mqtt:
  base_topic: zigbee2mqtt
  server: 'mqtt://mosquitto-svc:80'

serial:
  adapter: zstack
  # Location of adapter
  port: /dev/ttyUSB0

frontend:
  port: 8080

# Store other config in other files, to support this file being readonly
# https://github.com/Koenkk/zigbee2mqtt/issues/2071
devices: devices.yaml
groups: groups.yaml
`,
  },
}, { provider });

export const ddclientConfigmap = new k8s.core.v1.ConfigMap('ddclient-configmap', {
  metadata: {
    name: 'ddclient-configmap',
  },
  data: {
    'ddclient.conf': `# This file is managed from K8s
daemon=3600
usev6=webv6,webv6=ipify-ipv6
protocol=porkbun
verbose=yes
debug=yes
apikey=${env.PORKBUN_API_KEY}
secretapikey=${env.PORKBUN_SECRET_API_KEY}
${env.BASE_DOMAIN}
`,
  },
}, { provider });

export const esphomeDataPvc = new k8s.core.v1.PersistentVolumeClaim('esphome-data-pvc', {
  metadata: {
    name: 'esphome-data-pvc',
    annotations: {
      'pulumi.com/skipAwait': 'true',
    },
  },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: {
      requests: {
        storage: '10Mi',
      },
    },
  },
}, { provider, replaceOnChanges: ['*'], deleteBeforeReplace: true });
