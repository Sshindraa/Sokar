# infra/caddy/README.md
#
# Reverse-proxy Caddy pour Sokar (VPS).
#
# Cf. spec canal-a-v1.1 §3.3 hébergement :
#   "P0 : VPS / Node Next standalone derrière Caddy ou Nginx
#    Cloudflare devant en proxy/CDN cache"
#
# Déploiement :
#   1. Installer Caddy sur le VPS (apt install caddy, ou via Docker)
#   2. Copier ce dossier dans /etc/caddy/
#   3. Le `import sites/*.caddy` du Caddyfile principal charge
#      automatiquement sokar-tech.caddy
#   4. systemctl reload caddy
#
# Process gérés par PM2 :
#   - sokar-api         sur 127.0.0.1:4000 (Fastify, /api/*)
#   - sokar-dashboard   sur 127.0.0.1:3000 (Next.js, marketing + admin)
#   - sokar-canal-a     sur 127.0.0.1:4002 (Next.js standalone, /r/* /restaurants/*)
#
# Cloudflare :
#   - DNS : A record sokar.tech → VPS IP
#   - Proxy : activé (orange cloud)
#   - SSL/TLS mode : "Full" (Caddy gère le certificat, Cloudflare trust)
#   - Cache : respect des Cache-Control headers de Caddy

Sites actifs :
- sokar-tech.caddy : sokar.tech + www.sokar.tech (dashboard + canal-a + api)
