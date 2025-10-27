# Cert-Manager Setup untuk Production SSL

## Problem Saat Ini

- Self-signed certificate tidak trusted oleh browser/curl
- Let's Encrypt terkena rate limit sampai ~01:10 UTC
- Perlu solusi production-ready yang trusted

## Solusi: Cert-Manager dengan Let's Encrypt

### 1. Install Cert-Manager

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.2/cert-manager.yaml

# Verify installation
kubectl get pods -n cert-manager
```

### 2. Create ClusterIssuer untuk Let's Encrypt

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@filosofine.com
    privateKeySecretRef:
      name: letsencrypt-prod-private-key
    solvers:
      - http01:
          ingress:
            class: traefik
```

### 3. Update Ingress untuk Cert-Manager

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: gomeet-ingress-cert-manager
  namespace: gomeet
  annotations:
    kubernetes.io/ingress.class: traefik
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  tls:
    - hosts:
        - meet.filosofine.com
        - api-meet.filosofine.com
        - livekit.filosofine.com
      secretName: gomeet-tls-cert
  rules:
  # ... existing rules
```

### 4. Benefits

- ✅ Automatic certificate renewal
- ✅ Production-ready trusted certificates
- ✅ Better rate limit handling
- ✅ Integrated dengan Kubernetes

### 5. Alternative: Cloudflare Origin Certificate

Jika domain menggunakan Cloudflare:

1. Generate Origin Certificate di Cloudflare dashboard
2. Create Kubernetes secret
3. Set SSL mode ke "Full (strict)"
4. Update ingress untuk menggunakan certificate

## Immediate Action Plan

1. Install cert-manager
2. Setup ClusterIssuer
3. Update ingress configuration
4. Test certificate generation
5. Verify HTTPS dengan trusted certificate
