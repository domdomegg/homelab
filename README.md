# homelab

Infrastructure as code (IaC) configuration for my homelab setup.

Currently hosted on a [Dell XPS 9370](https://en.wikipedia.org/wiki/Dell_XPS#XPS_13_(9370,_Early_2018)) with a SONOFF Zigbee Dongle-P adapter. Mostly managed with [Pulumi](https://www.pulumi.com/), via [the Kubernetes provider](https://www.pulumi.com/registry/packages/kubernetes/).

Automatically deployed via GitHub CI.

## Adding a new service

Add a block to [`appDefinitions.ts`](./src/k8s/appDefinitions.ts).

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

    Find it in /etc/rancher/k3s/k3
    You might want to tweak the `server: ` line to set the remote address, and potentially add `tls-server-name: kubernetes` to avoid certificate warnings.

    Or, on the external system you want to get the config, run:
    ```bash
    # NB: this will overwrite ~/.kube/config
    mkdir -p ~/.kube && ssh -t xps 'sudo cat /etc/rancher/k3s/k3s.yaml | sed "s/\[::1]/\[$(ip route get 2606:4700:4700::1111 | awk '\''{print $11}'\'')]/g"' > ~/.kube/config
    ```
    This will substitute in the IP the system uses to reach the internet as the address to connect with kubectl.

### Useful server admin commands

These commands will work provided you've followed the steps above to set up the server.

- SSH into the server: `ssh xps`
- Run an ad-hoc shell inside the k8s cluster (so you can ping or wget cluster ips etc.): `kubectl run -i --tty --rm --restart=Never debug-shell --image=busybox -- /bin/sh`
