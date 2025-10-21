# Environment Variables Security Guide

This document explains how to securely manage environment variables in the GoMeet project.

## Overview

Environment variables contain sensitive information such as database credentials, API keys, and JWT secrets. Proper management of these variables is crucial for application security.

## Security Principles

### 1. Never Commit Secrets to Version Control
- ✅ Use `.env.example` as templates
- ✅ Add `.env` files to `.gitignore`
- ❌ Never commit actual values to repository
- ❌ Never hardcode secrets in code

### 2. Use Different Environments
- **Development**: Local `.env` file
- **Staging**: GitHub Secrets + Environment-specific secrets
- **Production**: GitHub Secrets + Strict access control

### 3. Principle of Least Privilege
- Grant minimum required permissions
- Rotate secrets regularly
- Use different secrets for different environments
- Audit secret access

## Environment Files

### Local Development (`.env`)
Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

Fill in your local development values:
```env
# Database Configuration
POSTGRES_DB=gomeet_db
POSTGRES_USER=gomeet
POSTGRES_PASSWORD=your_local_password

# Application Configuration
JWT_SECRET=your_local_jwt_secret_min_32_chars
LIVEKIT_API_KEY=your_livekit_key
LIVEKIT_API_SECRET=your_livekit_secret
```

### Environment Templates

#### Development Template (`.env.example`)
```env
# Database Configuration
POSTGRES_DB=gomeet_db
POSTGRES_USER=gomeet
POSTGRES_PASSWORD=your_secure_password_here

# Application Configuration
PORT=8080
DB_HOST=postgres
DB_PORT=5432
DB_USER=gomeet
DB_PASSWORD=your_secure_password_here
DB_NAME=gomeet_db
REDIS_HOST=redis
REDIS_PORT=6379
JWT_SECRET=your-super-secret-jwt-key-min-32-characters
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173

# Frontend Configuration
PUBLIC_API_URL=http://localhost:8080/api/v1
PUBLIC_WS_URL=ws://localhost:8080
PUBLIC_APP_NAME=GoMeet

# LiveKit Configuration
LIVEKIT_KEYS=your-livekit-api-key:your-livekit-api-secret
```

#### Production Template (`.env.production.example`)
```env
# Application Configuration
APP_NAME=GoMeet
APP_ENV=production
APP_DEBUG=false
APP_URL=https://gomeet.example.com

# Database Configuration
DB_HOST=your-production-db-host
DB_PORT=5432
DB_USER=your-production-db-user
DB_PASSWORD=your-production-db-password
DB_NAME=your-production-db-name
DB_SSL_MODE=require
DB_MAX_CONNECTIONS=20
DB_MAX_IDLE_CONNECTIONS=5
DB_CONNECTION_MAX_LIFETIME=300s

# Redis Configuration
REDIS_HOST=your-production-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-production-redis-password
REDIS_DB=0
REDIS_POOL_SIZE=10

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-min-32-characters
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=168h

# CORS Configuration
CORS_ALLOWED_ORIGINS=https://gomeet.example.com,https://www.gomeet.example.com
CORS_ALLOWED_METHODS=GET,POST,PUT,DELETE,OPTIONS
CORS_ALLOWED_HEADERS=Content-Type,Authorization,X-Requested-With

# LiveKit Configuration
LIVEKIT_HOST=your-livekit-host
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
LIVEKIT_ROOM_NAME_PREFIX=gomeet-

# TURN Server Configuration
TURN_SERVER_URL=turn:your-turn-server.example.com:3478
TURN_SERVER_USERNAME=your-turn-username
TURN_SERVER_CREDENTIAL=your-turn-password
```

## Docker Compose Security

### Development Docker Compose (`docker-compose.yml`)
Uses environment variables from `.env` file:
```yaml
services:
  postgres:
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
  
  backend:
    environment:
      DB_PASSWORD: ${DB_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      LIVEKIT_API_KEY: ${LIVEKIT_API_KEY}
      LIVEKIT_API_SECRET: ${LIVEKIT_API_SECRET}
```

### Production Docker Compose (`docker-compose.prod.yml`)
Uses environment variables from GitHub secrets:
```yaml
services:
  backend:
    environment:
      DB_PASSWORD: ${POSTGRES_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      LIVEKIT_API_KEY: ${LIVEKIT_API_KEY}
      LIVEKIT_API_SECRET: ${LIVEKIT_API_SECRET}
```

## GitHub Secrets Configuration

### Required GitHub Secrets

#### Database & Authentication
- `POSTGRES_DB`: Database name for staging
- `POSTGRES_USER`: Database username for staging
- `POSTGRES_PASSWORD`: Database password for staging
- `POSTGRES_DB_PROD`: Database name for production
- `POSTGRES_USER_PROD`: Database username for production
- `POSTGRES_PASSWORD_PROD`: Database password for production
- `REDIS_PASSWORD`: Redis password for staging
- `REDIS_PASSWORD_PROD`: Redis password for production
- `JWT_SECRET`: JWT secret for staging
- `JWT_SECRET_PROD`: JWT secret for production

#### Application Configuration
- `APP_NAME`: Application name
- `APP_VERSION`: Application version
- `STAGING_CORS_ORIGINS`: CORS allowed origins for staging
- `PRODUCTION_CORS_ORIGINS`: CORS allowed origins for production
- `LIVEKIT_API_KEY`: LiveKit API key for staging
- `LIVEKIT_API_SECRET`: LiveKit API secret for staging
- `LIVEKIT_API_KEY_PROD`: LiveKit API key for production
- `LIVEKIT_API_SECRET_PROD`: LiveKit API secret for production

#### TURN Server Configuration
- `TURN_SERVER_URL`: TURN server URL for staging
- `TURN_SERVER_USERNAME`: TURN server username for staging
- `TURN_SERVER_CREDENTIAL`: TURN server credential for staging
- `TURN_SERVER_URL_PROD`: TURN server URL for production
- `TURN_SERVER_USERNAME_PROD`: TURN server username for production
- `TURN_SERVER_CREDENTIAL_PROD`: TURN server credential for production

#### Deployment Server Configuration
- `DEPLOY_SERVER_HOST`: Staging server hostname or IP
- `DEPLOY_SERVER_USER`: SSH username for staging server
- `DEPLOY_SERVER_KEY`: SSH private key for staging server
- `DEPLOY_PATH`: Deployment directory path on staging server
- `DEPLOY_SERVER_HOST_PROD`: Production server hostname or IP
- `DEPLOY_SERVER_USER_PROD`: SSH username for production server
- `DEPLOY_SERVER_KEY_PROD`: SSH private key for production server
- `DEPLOY_PATH_PROD`: Deployment directory path on production server

#### Application URLs
- `STAGING_API_URL`: Staging API URL
- `STAGING_FRONTEND_URL`: Staging frontend URL
- `STAGING_WS_URL`: Staging WebSocket URL
- `PRODUCTION_API_URL`: Production API URL
- `PRODUCTION_FRONTEND_URL`: Production frontend URL
- `PRODUCTION_WS_URL`: Production WebSocket URL

## Secret Management Best Practices

### Environment-specific Secrets
- Use different secrets for staging and production
- Never share secrets between environments
- Use descriptive names for easy identification
- Document secret purposes and rotation schedules

### Secret Generation
- Use cryptographically secure random generators
- Minimum length requirements:
  - JWT secrets: 32 characters
  - Database passwords: 16 characters
  - API keys: 32 characters
- Include special characters and numbers
- Avoid dictionary words or predictable patterns

### Secret Storage
- Store secrets in GitHub repository secrets
- Use environment-specific secret groups
- Limit access to necessary team members
- Enable audit logging for secret access

## CI/CD Pipeline Security

### Environment Variable Injection

The CI/CD pipeline securely injects environment variables:

#### Staging Deployment
```yaml
- name: Create environment file for staging
  run: |
    cat > .env.staging << EOF
    POSTGRES_DB=${{ secrets.POSTGRES_DB }}
    POSTGRES_USER=${{ secrets.POSTGRES_USER }}
    POSTGRES_PASSWORD=${{ secrets.POSTGRES_PASSWORD }}
    JWT_SECRET=${{ secrets.JWT_SECRET }}
    EOF
```

#### Production Deployment
```yaml
- name: Create environment file for production
  run: |
    cat > .env.production << EOF
    POSTGRES_DB=${{ secrets.POSTGRES_DB_PROD }}
    POSTGRES_USER=${{ secrets.POSTGRES_USER_PROD }}
    POSTGRES_PASSWORD=${{ secrets.POSTGRES_PASSWORD_PROD }}
    JWT_SECRET=${{ secrets.JWT_SECRET_PROD }}
    EOF
```

### Secure Deployment Process
- SSH key-based authentication
- Environment file creation on-the-fly
- No secrets stored in repository
- Automatic cleanup of temporary files

## Security Best Practices

### 1. Secret Rotation
- Rotate secrets regularly (every 90 days)
- Use automated rotation where possible
- Update all references when rotating
- Test rotation in staging first

### 2. Access Control
- Limit who can access secrets
- Use role-based access control
- Implement audit logging
- Review access permissions regularly

### 3. Monitoring & Alerting
- Monitor secret access
- Alert on unusual activity
- Log all secret usage
- Regular security audits

### 4. Backup & Recovery
- Backup secrets securely
- Test secret restoration
- Document recovery procedures
- Have emergency access procedures

## Common Security Mistakes to Avoid

### ❌ Don't Do This
- Commit `.env` files to version control
- Hardcode secrets in source code
- Use the same secrets across environments
- Share secrets via email or chat
- Store secrets in plain text files
- Use weak or predictable secrets

### ✅ Do This Instead
- Use environment-specific secrets
- Store secrets in secure vaults
- Rotate secrets regularly
- Use strong, unique secrets
- Implement proper access controls
- Monitor secret usage

## Troubleshooting

### Common Issues

1. **Environment Variables Not Loading**
   - Check `.env` file format
   - Verify variable names match
   - Ensure proper file permissions

2. **Docker Compose Issues**
   - Verify environment variables are set
   - Check Docker Compose syntax
   - Ensure proper variable substitution

3. **CI/CD Pipeline Failures**
   - Verify GitHub secrets are configured
   - Check secret names in workflow files
   - Ensure proper secret access permissions

4. **SSH Connection Issues**
   - Verify SSH key format and permissions
   - Check server connectivity
   - Ensure proper user permissions

### Debugging Steps

1. **Local Development**
   ```bash
   # Check environment variables
   printenv | grep -E "(POSTGRES|REDIS|JWT|LIVEKIT)"
   
   # Test Docker Compose
   docker-compose config
   ```

2. **CI/CD Pipeline**
   ```bash
   # Check workflow logs
   # Verify secret injection
   # Test environment file creation
   ```

3. **Production Server**
   ```bash
   # Check Docker containers
   docker ps -a
   
   # Check container logs
   docker logs gomeet-backend-prod
   
   # Test environment variables
   docker exec gomeet-backend-prod env | grep -E "(POSTGRES|REDIS|JWT)"
   ```

## Compliance & Auditing

### Security Compliance
- Follow OWASP guidelines
- Implement proper logging
- Regular security assessments
- Document security procedures

### Audit Requirements
- Track secret access
- Log configuration changes
- Monitor usage patterns
- Regular security reviews

## Server Security

### SSH Key Management
- Use strong SSH keys (ED25519 or RSA 4096+)
- Set appropriate file permissions (600 for private keys)
- Use passphrase-protected keys
- Regular key rotation

### Server Hardening
- Regular system updates
- Firewall configuration
- Fail2ban or similar intrusion prevention
- Log monitoring and alerting

### Docker Security
- Use non-root containers
- Regular image updates
- Security scanning
- Resource limits

## Related Documentation

- [CI/CD Setup Guide](CI_CD_SETUP.md)
- [Docker Configuration](../README.md#docker)
- [Deployment Guide](DEPLOYMENT.md)
- [Security Guidelines](SECURITY.md)