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

    Run:
    ```bash
    curl -sfL https://get.k3s.io | sh -s - --disable=traefik --cluster-cidr=fd7d:4ce0:5b35:1::/64,10.42.0.0/16 --service-cidr=fd7d:4ce0:5b35:2::/112,10.43.0.0/16 --flannel-ipv6-masq
    sudo systemctl enable shutdown-k3s.service
    ```

    Cluster CIDR range can be generated with https://unique-local-ipv6.com/ (replace `fd7d:4ce0:5b35` with the part you've generated here). We disable traefik because we use ingress-nginx instead.

    The boot-relevant flags (`--disable=traefik`, `--flannel-ipv6-masq`) are persisted in `/etc/rancher/k3s/config.yaml` so they survive re-running the installer (see [Upgrading k3s](#upgrading-k3s) below):
    ```yaml
    disable:
      - traefik
    flannel-ipv6-masq: true
    ```
12. Set up Bluetooth for Home Assistant (see [official docs](https://www.home-assistant.io/integrations/bluetooth)). In short on my device it was:
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
13. Get the kubeconfig.

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
# On the XPS. Because the flags live in config.yaml, the upgrade command needs NO cli flags:
curl -sfL https://get.k3s.io | sudo INSTALL_K3S_VERSION=v1.34.9+k3s1 sh -s -
```

After each hop verify: `kubectl get nodes` is `Ready`, `kubectl get servicecidr` shows the configured ranges (`fd7d:4ce0:5b35:2::/112` + `10.43.0.0/16`, **not** a `fd00:...` default), the k3s log is free of `not within any service CIDR` errors, and pods return to Running. Latest per-minor version tags: `curl -s https://update.k3s.io/v1-release/channels`.

Two gotchas, both learned the hard way:

- **Keep the server flags in exactly one place.** Re-running the installer with only `INSTALL_K3S_VERSION` regenerates a bare systemd unit and drops any flags passed on the original install — which is why they now live in `config.yaml`. Don't *also* pass them on the upgrade command.
- **Never put `cluster-cidr` / `service-cidr` in `config.yaml`.** They are creation-only (already baked into the datastore on an existing cluster). If both `config.yaml` and the systemd unit's `ExecStart` carry them, k3s concatenates the two sources → `--service-cluster-ip-range must not contain more than two entries` → k3s refuses to start. On k3s 1.33+ a mismatched/default service CIDR also makes the new ServiceCIDR controller reject every existing Service (`not within any service CIDR`) and crash-loop the apiserver.

### Useful server admin commands

These commands will work provided you've followed the steps above to set up the server.

- SSH into the server: `ssh xps`
- Run an ad-hoc shell inside the k8s cluster (so you can ping or wget cluster ips etc.): `kubectl run -i --tty --rm --restart=Never debug-shell --image=busybox -- /bin/sh`
