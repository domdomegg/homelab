# homelab

Infrastructure as code (IaC) configuration for my homelab setup.

Currently hosted on a [Dell XPS 9370](https://en.wikipedia.org/wiki/Dell_XPS#XPS_13_(9370,_Early_2018)) with a SONOFF Zigbee Dongle-P adapter. Mostly managed with [Pulumi](https://www.pulumi.com/), via [the Kubernetes provider](https://www.pulumi.com/registry/packages/kubernetes/).

Automatically deployed via GitHub CI.

## Adding a new service

Add a block to [`appDefinitions.ts`](./src/k8s/appDefinitions.ts).

## Restarting a service

Useful e.g. to get an MCP server running `npx -y <package>` to pick up the latest published version, without needing kubectl access.

Run the [Restart service workflow](https://github.com/domdomegg/homelab/actions/workflows/restart.yaml) from the Actions tab, or:

```bash
gh workflow run restart.yaml -f service=google-drive-mcp
```

The service name is the `name` from [`appDefinitions.ts`](./src/k8s/appDefinitions.ts).

## Backups

The `backup` CronJob ([`backup.ts`](./src/k8s/backup.ts)) runs nightly at 03:30 Europe/London. It tars and gzips the Home Assistant and Zigbee2MQTT volumes, encrypts the archive with [age](https://age-encryption.org), and uploads it to `homelab-backups/` in Google Drive using rclone. Retention keeps the newest 7 in `daily/`, 4 Monday copies in `weekly/` and 6 copies from the 1st in `monthly/`. HA's own `backups/`, `tts/`, `deps/`, `.cache/` and logs are left out, and an archive is about 60 MB.

Check on it with `kubectl get cronjob,jobs` and `kubectl logs job/<name>`. A failed run shows as a failed Job.

### Setting up

Both values go in `homelab/prod.ts` in `domdomegg/secrets`, which is the `PROD_ENV` GitHub secret. While either is empty, the job fails.

- `BACKUP_AGE_RECIPIENT`: run `age-keygen -o homelab-backup-key.txt`, then use the `Public key: age1...` it prints. Keep `homelab-backup-key.txt` in `domdomegg/secrets`. It's the only way to decrypt the backups, and it never goes into the cluster.
- `BACKUP_RCLONE_DRIVE_TOKEN`: on a machine with a browser, run the commands below and sign in as the Drive owner. Then use the JSON token they print. The `drive.file` scope only lets the token see files that rclone created.
  ```bash
  rclone config create homelab-backup drive scope=drive.file
  rclone config show homelab-backup | sed -n 's/^token = //p'
  ```

### Restoring

1. Download a backup, either from the Drive web UI or with `rclone copy homelab-backup:homelab-backups/daily/homelab-backup-YYYY-MM-DD.tar.gz.age .`
2. Optionally inspect it with `age -d -i homelab-backup-key.txt homelab-backup-YYYY-MM-DD.tar.gz.age | tar -tz`. It contains `ha/` (HA's `/config`) and `zigbee2mqtt/` (Z2M's `/app/data`).
3. Stop the apps and start a pod that mounts both volumes:
   ```bash
   kubectl scale deploy/ha-deployment deploy/zigbee2mqtt-deployment --replicas=0
   kubectl run restore --image=busybox --restart=Never --overrides='{"spec":{"containers":[{"name":"restore","image":"busybox","command":["sleep","3600"],"volumeMounts":[{"name":"ha","mountPath":"/volumes/ha"},{"name":"z2m","mountPath":"/volumes/zigbee2mqtt"}]}],"volumes":[{"name":"ha","persistentVolumeClaim":{"claimName":"ha-data-pvc"}},{"name":"z2m","persistentVolumeClaim":{"claimName":"zigbee2mqtt-data-pvc"}}]}}'
   kubectl wait --for=condition=Ready pod/restore
   ```
4. Extract the archive onto the volumes. To roll back a volume rather than fill an empty one, clear it first, e.g. `kubectl exec restore -- find /volumes/zigbee2mqtt -mindepth 1 -delete`.
   ```bash
   age -d -i homelab-backup-key.txt homelab-backup-YYYY-MM-DD.tar.gz.age | kubectl exec -i restore -- tar -xz -C /volumes
   ```
5. Clean up and start the apps again:
   ```bash
   kubectl delete pod restore
   kubectl scale deploy/ha-deployment deploy/zigbee2mqtt-deployment --replicas=1
   ```

This is also how to set up a fresh volume. HACS lives in `custom_components/`, which the backup includes, and HA's `configuration.yaml` comes from its ConfigMap.

## Local development

1. Install Node.js
2. Install Pulumi CLI
3. Get access keys to domdomegg AWS account
4. Create `~/.aws/config` with the contents:
   ```ini
   [default]
   region = eu-west-1
   ```
5. Create `~/.aws/credentials` file with the contents:
   ```ini
   [default]
   aws_access_key_id = <ACCESS_KEY_ID_FOR_DOMDOMEGG_ACCOUNT>
   aws_secret_access_key = <ACCESS_KEY_ID_FOR_DOMDOMEGG_ACCOUNT>
   ```
6. Run `pulumi login s3://domdomegg-pulumi-backend/homelab`
7. See step in manual setup notes below to get kubeconfig
8. Deploy with `npm run deploy:prod`

## Remote access / debugging connectivity

`home.adamjones.me` has two very different faces:

- **AAAA record** → the XPS directly. Works only from networks with IPv6.
- **A record** → the Oracle Cloud relay (130.162.187.38) running
  [ipv6-proxy](https://github.com/domdomegg/ipv6-proxy), which forwards
  **only ports 80 and 443** to the XPS. Port 22 on the IPv4 address is the
  *relay's own sshd* — this is why `ssh xps` from an IPv4-only network fails
  with a scary host-key-changed warning: you're talking to the wrong machine,
  not being MITM'd (probably).

From an IPv4-only network:

- **SSH to the XPS**: doesn't work even via the relay as a jump host — the
  router firewall only pinholes 80/443/6443, and port 22 gets refused.
  Fix by adding a router pinhole, or use the kubectl route below and a
  privileged pod with `nsenter -t 1 -m -u -i -n` for host access.
- **kubectl**: port 6443 *is* pinholed, so tunnel through the relay:
  ```sh
  ssh -f -N -L "16443:[$(dig +short AAAA home.adamjones.me)]:6443" ubuntu@130.162.187.38
  kubectl --server=https://127.0.0.1:16443 --tls-server-name=localhost get nodes
  ```
  (`--tls-server-name=localhost` because the apiserver cert's SANs don't
  include home.adamjones.me.)
- **Pulumi deploys** work over the same tunnel: write the server override
  into a copy of your kubeconfig and run `KUBECONFIG=<copy> npm run deploy:prod`.

## Manual setup notes

To get a kubernetes cluster that you can run this all on, we install Ubuntu server + k3s. Full instructions:

1. Download the [Ubuntu Server](https://ubuntu.com/download/server) `.iso`
2. Install [Ventoy](https://www.ventoy.net/en/doc_start.html) onto a USB stick, and copy over Ubuntu Server
3. Run the Ubuntu Server installer via Ventoy, and during installation choose:
   - Connect to internet
   - Enable OpenSSH server
   - Only allow connecting via SSH keys
     - Can use the GitHub keys temporarily, we'll replace them in a second
4. (recommended) SSH in to the machine remotely - generally easier to copy and paste the next bits from a machine with easy access to these instructions. The following instructions assume you've created an [SSH config entry](https://linuxize.com/post/using-the-ssh-config-file/) called `xps` to connect, i.e. you can do `ssh xps`.
5. Replace SSH keys with the key you want to use. Adam: for `id_ed25519_xps`:
   ```bash
   echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC6fJP2IaW0o1y3xT2SwwNjT8zC3V4CpNCGYYVEY3eVv" > ~/.ssh/authorized_keys
   ```
6. Enable sudo without password
   ```bash
   sudo visudo
   ```
   In the file, change the %sudo line to:
   ```
   %sudo   ALL=(ALL:ALL) NOPASSWD: ALL
   ```
   (Why: Avoids needing to manage a separate sudo password. Also see [this security discussion](https://security.stackexchange.com/questions/45712/how-secure-is-nopasswd-in-passwordless-sudo-mode))
7. Harden security by setting password to random value, and then locking it to disable its use, then disabling getty.
   ```bash
   echo $USER:$(openssl rand -base64 24) | chpasswd
   sudo passwd -l $USER
   sudo systemctl mask getty@.service
   ```
   NB: this will make the device only accessible via SSH
8. Expand the storage space to the whole disk (by default only 100GB is used)
   ```bash
   sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv
   sudo resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv
   ```
9. Set the display to blank after 30s of inactivity, by editing `/etc/default/grub` to set:
   ```ini
   GRUB_CMDLINE_LINUX_DEFAULT="consoleblank=30"
   ```
   then apply the changes to the configuration file with:
   ```bash
   sudo update-grub
   ```
10. (for laptops) Make closing the lid not put it to sleep, by editing `/etc/systemd/logind.conf` to add:
   ```ini
   HandleLidSwitch=ignore
   LidSwitchIgnoreInhibited=no
   ```
   Then restart systemd with:
   ```bash
   sudo service systemd-logind restart
   ```
11. Install k3s
    Create /etc/systemd/system/shutdown-k3s.service:
    ```ini
    # From https://github.com/k3s-io/k3s/issues/2400#issuecomment-1312621468

    [Unit]
    Description=Kill containerd-shims on shutdown
    DefaultDependencies=false
    Before=shutdown.target umount.target

    [Service]
    ExecStart=/usr/local/bin/k3s-killall.sh
    Type=oneshot

    [Install]
    WantedBy=shutdown.target
    ```

    All k3s server settings live in `/etc/rancher/k3s/config.yaml`, so the installer never needs flags (see [Upgrading k3s](#upgrading-k3s) below). Create it before installing:
    ```yaml
    node-ip: <node's public IPv6>,<node's LAN IPv4>
    kube-apiserver-arg:
      # Let GitHub Actions authenticate with OIDC tokens (see src/k8s/ciRbac.ts)
      - authentication-config=/etc/rancher/k3s/github-oidc-auth.yaml
      # Let AWS federate against service account tokens (see src/aws/clusterOidcProvider.ts)
      - service-account-issuer=https://k8s-oidc.home.adamjones.me
      - service-account-issuer=https://kubernetes.default.svc.cluster.local
    disable:
      - traefik
    flannel-ipv6-masq: true
    cluster-cidr: fd7d:4ce0:5b35:1::/64,10.42.0.0/16
    service-cidr: fd7d:4ce0:5b35:2::/112,10.43.0.0/16
    ```

    And `/etc/rancher/k3s/github-oidc-auth.yaml`:
    ```yaml
    apiVersion: apiserver.config.k8s.io/v1
    kind: AuthenticationConfiguration
    jwt:
      - issuer:
          url: https://token.actions.githubusercontent.com
          audiences:
            - homelab-k8s
        claimMappings:
          username:
            # Map the GitHub token subject to a k8s username. Only the exact
            # repo+branch below is granted RBAC; other subs authenticate but have
            # no permissions.
            claim: sub
            prefix: "github:"
        claimValidationRules:
          - claim: sub
            requiredValue: "repo:domdomegg/homelab:ref:refs/heads/master"
    ```

    Then run:
    ```bash
    curl -sfL https://get.k3s.io | sh -s -
    sudo systemctl enable shutdown-k3s.service
    ```

    Cluster CIDR range can be generated with https://unique-local-ipv6.com/ (replace `fd7d:4ce0:5b35` with the part you've generated here). The CIDRs can't be changed after the cluster is created. We disable the bundled Traefik so we can install our own via Helm, version-pinned and configured in [`traefik.ts`](./src/k8s/traefik.ts).
12. Add the host firewall. It blocks just two ports from outside the machine: `8472/udp` (flannel VXLAN, which is unauthenticated, so anyone who can reach it can inject packets into the pod network) and `10250/tcp` (the kubelet API). Neither is needed from outside on a single-node cluster. Everything else (SSH, 80/443 via Traefik, 6443 for CI, Home Assistant's host-network ports) is deliberately left open as before, and traffic from loopback, the k3s interfaces and the pod/service CIDRs is still allowed (e.g. metrics-server scrapes the kubelet from a pod).

    The rules are a dedicated nftables table, [`host/hostfw.nft`](./host/hostfw.nft), loaded at boot by [`host/hostfw.service`](./host/hostfw.service). This doesn't use ufw (which fights k3s's iptables rules) or the stock `nftables.service` (its `/etc/nftables.conf` runs `flush ruleset`, which would wipe k3s's rules).

    From a checkout of this repo:
    ```bash
    scp host/hostfw.nft host/hostfw.service xps:/tmp/
    ```
    Then on the XPS:
    ```bash
    sudo install -m 644 /tmp/hostfw.nft /etc/hostfw.nft
    sudo install -m 644 /tmp/hostfw.service /etc/systemd/system/hostfw.service
    sudo systemctl daemon-reload
    # Safety net: undo it in 5 minutes unless cancelled
    sudo systemd-run --unit=hostfw-rollback --on-active=5min sh -c 'nft delete table inet hostfw; systemctl disable hostfw.service'
    sudo systemctl enable --now hostfw.service
    ```
    Keep this session open, and check `ssh xps` and `kubectl get nodes` still work from a new terminal. Then cancel the rollback:
    ```bash
    sudo systemctl stop hostfw-rollback.timer
    ```
    To change the rules later, edit `/etc/hostfw.nft` and run `sudo systemctl reload hostfw`.
13. Set up Bluetooth for Home Assistant (see [official docs](https://www.home-assistant.io/integrations/bluetooth)). In short on my device it was:
    ```bash
    sudo apt install -y bluez

    # nb: may not be necessary after Ubuntu 23.10
    # https://www.phoronix.com/news/Ubuntu-23.10-Dbus-Broker-Plan
    sudo apt install dbus-broker -y
    sudo systemctl stop dbus
    sudo systemctl disable dbus
    sudo systemctl start dbus-broker
    sudo systemctl enable dbus-broker
    ```
14. Get the kubeconfig.

    Find it in `/etc/rancher/k3s/k3s.yaml`.
    You might want to tweak the `server: ` line to set the remote address, and potentially add `tls-server-name: localhost` to avoid certificate warnings (this matches the flag used in the remote access section above).

    Or, on the external system you want to get the config, run:
    ```bash
    # NB: this will overwrite ~/.kube/config
    mkdir -p ~/.kube && ssh -t xps 'sudo cat /etc/rancher/k3s/k3s.yaml | sed "s/\[::1]/\[$(ip route get 2606:4700:4700::1111 | awk '\''{print $11}'\'')]/g"' > ~/.kube/config
    ```
    This will substitute in the IP the system uses to reach the internet as the address to connect with kubectl.

## Upgrading k3s

k3s does not auto-update, so it needs upgrading manually (an EOL, internet-facing apiserver is a real risk). Kubernetes only supports **one minor version at a time**, so walk it up one minor per hop (e.g. `v1.33.x` → `v1.34.x` → …), verifying health between each:

```bash
# On the XPS. All settings live in config.yaml, so the upgrade command takes no flags:
curl -sfL https://get.k3s.io | sudo INSTALL_K3S_VERSION=v1.34.9+k3s1 sh -s -
```

After each hop verify: `kubectl get nodes` is `Ready`, `kubectl get servicecidr` shows the configured ranges (`fd7d:4ce0:5b35:2::/112` + `10.43.0.0/16`, **not** a `fd00:...` default), the k3s log is free of `not within any service CIDR` errors, and pods return to Running. Latest per-minor version tags: `curl -s https://update.k3s.io/v1-release/channels`.

Two gotchas, both learned the hard way:

- **Never pass server flags to the installer.** Re-running it regenerates the systemd unit from only the flags given on that run, so flags from an earlier install silently disappear. Keep every setting in `config.yaml` instead.
- **Keep the cluster and service CIDRs exactly as the cluster was created.** k3s needs them on every start (via `config.yaml`). If they go missing or change, k3s falls back to defaults that don't match existing Services, and on 1.33+ the ServiceCIDR controller rejects every Service (`not within any service CIDR`) and crash-loops the apiserver. If they're set in both `config.yaml` and the unit's `ExecStart`, k3s concatenates them (`--service-cluster-ip-range must not contain more than two entries`) and refuses to start.
