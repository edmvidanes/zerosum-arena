# Zerosum beta installation

## 1. Prepare the EC2 instance

Use Amazon Linux 2023 with:

- at least 1 GB RAM and 8 GB storage;
- inbound TCP 80 from the intended testers; and
- inbound TCP 22 restricted to the administrator's IP.

The installer adds a 1 GB swap file on small instances, installs Docker and Docker Compose, enables daily backups, and starts the containers automatically after a restart.

The computer used to deploy must have Node.js 20 or newer, npm, `tar`, `ssh`, and `scp`. Keep the EC2 private key on that computer and do not copy it to the server or repository.

## 2. Create the private server configuration

This section is required once on every new EC2 instance. Connect to the server:

```bash
ssh -i /path/to/zerosum.pem ec2-user@EC2_PUBLIC_IP
```

Create the protected configuration directory and file:

```bash
sudo install -d -o root -g root -m 0700 /etc/zerosum
sudo install -o root -g root -m 0600 /dev/null /etc/zerosum/zerosum.env
sudoedit /etc/zerosum/zerosum.env
```

Enter the following values in the editor. Replace both email and password placeholders. Passwords must be different and at least 12 characters long.

```dotenv
FREE_ACCOUNT_EMAIL=free@example.com
FREE_ACCOUNT_PASSWORD=replace-with-a-long-random-password
PAID_ACCOUNT_EMAIL=paid@example.com
PAID_ACCOUNT_PASSWORD=replace-with-a-different-long-random-password
PUBLIC_BETA_MODE=true
PUBLIC_BETA_MAX_ACTIVE_TOURNAMENTS=25
```

Save the file and verify its permissions without displaying its contents:

```bash
sudo chown root:root /etc/zerosum/zerosum.env
sudo chmod 0600 /etc/zerosum/zerosum.env
sudo stat -c '%a %U:%G %n' /etc/zerosum/zerosum.env
```

The result should begin with `600 root:root`. Never commit or copy this completed file into the repository.

The current beta keeps sign-in available and grants anonymous hosts the 50-player beta allowance with included packs. Anonymous and free hosts receive redacted question data and cannot create or import packs. A signed-in paid test host can create private packs, import JSON or CSV, inspect answer keys, and review questions used during a tournament. Custom packs remain scoped to their owning account. Account credentials are not published in this guide.

On the first application startup, ZeroSum creates the Free and Paid accounts from this file and stores salted password hashes in SQLite. Later changes to these password values do not reset an existing account. If the environment file already exists, leave it in place; deployments do not overwrite it.

## 3. Deploy from your computer

Run one of these commands from the Zerosum repository on your workstation. The scripts test the project, upload it over SSH, and install it on EC2.

Windows PowerShell:

```powershell
.\scripts\deploy-docker.ps1 -Ec2Host "EC2_PUBLIC_IP" -KeyPath ".\zerosum.pem"
```

Linux or macOS:

```bash
chmod 600 ~/.ssh/zerosum.pem
chmod +x scripts/deploy-docker.sh
./scripts/deploy-docker.sh --host "EC2_PUBLIC_IP" --key ~/.ssh/zerosum.pem
```

Add `--user USERNAME` to the Bash command when the SSH user is not `ec2-user`.

## 4. Verify

Open `http://EC2_PUBLIC_IP` in a browser. On the server, check:

```bash
curl -L http://127.0.0.1/api/health
cd /opt/zerosum/current
sudo docker compose ps
sudo docker compose logs --tail=100 app nginx
```

Both containers should be running and the health endpoint should return `"status":"ok"`.

The bundled Nginx limits are sized to tolerate a classroom sharing one public/NAT address. Do not lower the per-IP WebSocket limit below the expected number of students. For public SaaS deployment, use AWS WAF with CloudFront or an Application Load Balancer; EC2 security groups and application limits are not substitutes for upstream DDoS protection.

## Common operations

Follow logs:

```bash
cd /opt/zerosum/current
sudo docker compose logs -f app nginx
```

Restart the application:

```bash
cd /opt/zerosum/current
sudo docker compose restart
```

Run a backup:

```bash
sudo systemctl start zerosum-backup.service
```

Runtime data remains in `/var/lib/zerosum`, and backups are stored in `/var/backups/zerosum` for 14 days.

If the public IP changes, redeployment is unnecessary. Open the new IP or update DNS. For a new release, pass the new IP to the same deployment command.

## Redeploy or move to another EC2 instance

For an ordinary release on the same server, rerun the deployment command in section 3. The installer keeps the private environment file, database, backups, and TLS certificates outside the versioned release directory.

For a new EC2 instance:

1. complete sections 1 and 2 on the new server;
2. run the normal deployment command so the containers and persistent directories are created;
3. if this is a migration, stop the containers, restore the existing database as `/var/lib/zerosum/zerosum.sqlite`, set its owner to `1000:1000`, and restart the containers before opening the application to users;
4. verify HTTP, login, and WebSocket access; and
5. update DNS only after verification succeeds.

A fresh installation without the previous SQLite database creates only the two accounts from `/etc/zerosum/zerosum.env` and new copies of the included sample packs. It does not carry over private packs, tournaments, or accounts created on another server.

The current HTTP setup is for beta testing only. Add a stable domain and HTTPS before enabling sign-in or storing real customer data.

## Enable `zerosum.website` HTTPS

1. Assign an Elastic IP to the EC2 instance.
2. At the domain registrar, replace the parking records with:
   - `A`: host `@`, value set to the Elastic IP.
   - `CNAME`: host `www`, value `zerosum.website`.
3. Allow inbound TCP 80 and 443 in the EC2 security group. Keep SSH restricted to the administrator's IP.
4. Wait until both names resolve to the EC2 address.
5. Deploy the current version using the normal deployment command above.
6. Connect to EC2 and issue the certificate using an email that can receive expiration notices:

```bash
cd /opt/zerosum/current
sudo bash ops/enable-https.sh YOUR_EMAIL_ADDRESS
```

The script requests a trusted Let's Encrypt certificate for `zerosum.website` and `www.zerosum.website`, redirects HTTP and public-IP requests to `https://zerosum.website`, validates the Nginx configuration, and installs automatic renewal.

Verify both endpoints:

```bash
curl -L http://zerosum.website/api/health
curl https://zerosum.website/api/health
sudo systemctl status zerosum-tls-renew.timer
```

## Add a temporary HTTPS redirect domain

After the additional domain and its `www` record point to the same Elastic IP, run:

```bash
cd /opt/zerosum/current
sudo bash ops/add-redirect-domain.sh dalevids.biz https://zerosum.website/ YOUR_EMAIL_ADDRESS
```

This creates a temporary `302` redirect. Its configuration is stored outside the release directory, so normal Zerosum deployments preserve it. Remove `/etc/zerosum/nginx-conf.d/dalevids.biz.conf` when the portfolio replaces the redirect.
