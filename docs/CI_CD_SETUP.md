# CI/CD Setup Guide

This document explains the CI/CD pipeline setup for the GoMeet project.

## Overview

The GoMeet project uses GitHub Actions for continuous integration and deployment. The pipeline includes:

- **CI Pipeline**: Testing, linting, and security scanning
- **CD Pipeline**: Building Docker images and deploying to staging/production servers
- **Security Pipeline**: Regular security scans and vulnerability checks
- **Dependency Update Pipeline**: Automated dependency updates

## Required Secrets

To use the CI/CD pipeline, you need to configure the following secrets in your GitHub repository:

### General Secrets
- `GITHUB_TOKEN`: Automatically provided by GitHub Actions
- `SLACK_WEBHOOK_URL`: Slack webhook for deployment notifications
- `SECURITY_SLACK_WEBHOOK_URL`: Slack webhook for security notifications
- `DEPENDENCIES_SLACK_WEBHOOK_URL`: Slack webhook for dependency update notifications

### Deployment Server Secrets

#### Staging Server
- `DEPLOY_SERVER_HOST`: Staging server hostname or IP address
- `DEPLOY_SERVER_USER`: SSH username for staging server
- `DEPLOY_SERVER_KEY`: SSH private key for staging server
- `DEPLOY_PATH`: Deployment directory path on staging server

#### Production Server
- `DEPLOY_SERVER_HOST_PROD`: Production server hostname or IP address
- `DEPLOY_SERVER_USER_PROD`: SSH username for production server
- `DEPLOY_SERVER_KEY_PROD`: SSH private key for production server
- `DEPLOY_PATH_PROD`: Deployment directory path on production server

### Application Configuration Secrets
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

### Application URLs
- `STAGING_API_URL`: Staging API URL for health checks
- `STAGING_FRONTEND_URL`: Staging frontend URL for health checks
- `PRODUCTION_API_URL`: Production API URL for health checks
- `PRODUCTION_FRONTEND_URL`: Production frontend URL for health checks
- `STAGING_WS_URL`: Staging WebSocket URL
- `PRODUCTION_WS_URL`: Production WebSocket URL

### Application Configuration
- `APP_NAME`: Application name
- `APP_VERSION`: Application version
- `STAGING_CORS_ORIGINS`: CORS allowed origins for staging
- `PRODUCTION_CORS_ORIGINS`: CORS allowed origins for production

### TURN Server Configuration
- `TURN_SERVER_URL`: TURN server URL for staging
- `TURN_SERVER_USERNAME`: TURN server username for staging
- `TURN_SERVER_CREDENTIAL`: TURN server credential for staging
- `TURN_SERVER_URL_PROD`: TURN server URL for production
- `TURN_SERVER_USERNAME_PROD`: TURN server username for production
- `TURN_SERVER_CREDENTIAL_PROD`: TURN server credential for production

### LiveKit Configuration
- `LIVEKIT_API_KEY`: LiveKit API key for staging
- `LIVEKIT_API_SECRET`: LiveKit API secret for staging
- `LIVEKIT_API_KEY_PROD`: LiveKit API key for production
- `LIVEKIT_API_SECRET_PROD`: LiveKit API secret for production

### Security Tools (Optional)
- `SNYK_TOKEN`: Snyk API token for vulnerability scanning
- `GITLEAKS_LICENSE`: Gitleaks license for advanced secret scanning

## Workflow Files

### 1. CI Pipeline (`.github/workflows/ci.yml`)

Triggers on:
- Push to `main` and `develop` branches
- Pull requests to `main` and `develop` branches

Jobs:
- **lint-backend**: Go linting and vetting
- **test-backend**: Go tests with coverage
- **lint-frontend**: Frontend linting (ESLint, Prettier, TypeScript)
- **test-frontend**: Frontend tests and build
- **security-scan**: Basic security scanning with Trivy

### 2. CD Pipeline (`.github/workflows/cd.yml`)

Triggers on:
- Push to `main` branch
- Manual workflow dispatch

Jobs:
- **build-and-push**: Build and push Docker images to container registry
- **deploy-staging**: Deploy to staging server via SSH
- **deploy-production**: Deploy to production server via SSH (manual only)
- **health-check**: Verify deployment health
- **notify-slack**: Send deployment notifications

### 3. Security Pipeline (`.github/workflows/security.yml`)

Triggers on:
- Daily schedule at 2 AM UTC
- Push to `main` branch
- Pull requests to `main` branch
- Manual workflow dispatch

Jobs:
- **security-scan-backend**: Backend security scanning with Gosec and Trivy
- **security-scan-frontend**: Frontend security scanning with npm audit and Snyk
- **container-security-scan**: Container vulnerability scanning
- **dependency-check**: OWASP dependency check
- **secrets-scan**: Secret scanning with Gitleaks and TruffleHog
- **security-report**: Generate security summary

### 4. Dependency Update Pipeline (`.github/workflows/dependency-update.yml`)

Triggers on:
- Weekly schedule on Monday at 9 AM UTC
- Manual workflow dispatch

Jobs:
- **update-go-dependencies**: Update Go modules and create PR
- **update-node-dependencies**: Update Node.js packages and create PR
- **check-docker-base-images**: Check for Docker base image updates
- **security-audit**: Run security audits on dependencies
- **dependency-report**: Generate dependency update summary

## Environment Configuration

### Staging Environment
- Automatically deployed on push to `main` branch
- Uses staging server credentials
- Includes health checks and rollback capabilities

### Production Environment
- Manual deployment only
- Requires production server credentials
- Includes comprehensive health checks
- Sends notifications to designated channels

## Server Setup Requirements

### Prerequisites
- Docker and Docker Compose installed on deployment servers
- SSH access configured with key-based authentication
- Firewall rules allowing necessary ports (80, 443, 8080, 5173)
- SSL certificates configured for HTTPS (optional but recommended)

### Deployment Server Setup

#### 1. Install Docker and Docker Compose
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

#### 2. Configure SSH Access
```bash
# Create deployment user
sudo adduser deploy
sudo usermod -aG docker deploy

# Setup SSH key authentication
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
# Copy your public key to /home/deploy/.ssh/authorized_keys
```

#### 3. Create Deployment Directory
```bash
sudo mkdir -p /opt/gomeet
sudo chown deploy:deploy /opt/gomeet
```

## Docker Configuration

### Multi-stage Builds
Both backend and frontend use multi-stage Docker builds for optimization:

1. **Build Stage**: Compiles code and installs dependencies
2. **Production Stage**: Minimal runtime image with only necessary components

### Security Features
- Non-root users
- Health checks
- Minimal attack surface
- Security scanning

### Optimization Features
- Layer caching
- Parallel builds
- Small image sizes
- Fast startup times

## Deployment Process

### Staging Deployment
1. **Build**: Docker images are built and pushed to container registry
2. **Deploy**: SSH connection to staging server
3. **Setup**: Environment file creation and Docker Compose configuration
4. **Deploy**: Pull images and start services with Docker Compose
5. **Verify**: Health checks and service validation

### Production Deployment
1. **Build**: Docker images are built and pushed to container registry
2. **Deploy**: SSH connection to production server
3. **Backup**: Existing services are gracefully stopped
4. **Deploy**: Pull new images and start services
5. **Verify**: Comprehensive health checks and monitoring

## Monitoring and Observability

### Health Checks
- Backend: `/health` endpoint
- Frontend: Custom health check script
- Container-level health checks
- Database and Redis connectivity checks

### Logging
- Structured JSON logging
- Log levels configurable
- Local log files with rotation
- Optional centralized log aggregation

### Metrics
- Application metrics endpoint (port 9090)
- Container resource usage
- Performance monitoring
- Health status monitoring

## Security Best Practices

### Deployment Security
- SSH key-based authentication
- Limited user permissions
- Regular security updates
- Network segmentation

### Application Security
- Environment variable isolation
- Secret management
- Regular security scanning
- Dependency vulnerability checks

### Infrastructure Security
- Firewall configuration
- SSL/TLS encryption
- Regular backup procedures
- Access logging and monitoring

## Troubleshooting

### Common Issues

1. **Build Failures**
   - Check dependency versions
   - Verify environment variables
   - Review build logs

2. **Test Failures**
   - Check test environment setup
   - Verify test data
   - Review test logs

3. **Deployment Failures**
   - Check SSH credentials and connectivity
   - Verify Docker installation
   - Review deployment logs
   - Check server resources

4. **Health Check Failures**
   - Verify service startup
   - Check network connectivity
   - Review application logs
   - Validate environment configuration

### Debugging Steps

1. Check workflow logs in GitHub Actions
2. Review artifact outputs
3. Check service health endpoints
4. Verify environment configuration
5. Review security scan reports
6. Test SSH connectivity manually
7. Check Docker container status and logs

## Maintenance

### Regular Tasks
- Monitor workflow performance
- Review security scan results
- Update dependencies
- Optimize pipeline performance
- Check server resources and logs

### Performance Optimization
- Cache optimization
- Parallel execution
- Resource allocation
- Build time reduction
- Server resource monitoring

## Backup and Recovery

### Data Backup
- Regular database backups
- Volume data backups
- Configuration backups
- SSL certificate backups

### Recovery Procedures
- Service restart procedures
- Data restoration processes
- Configuration rollback
- Emergency access procedures

## Future Enhancements

### Planned Features
- Automated rollback on health check failure
- Integration with monitoring systems
- Blue-green deployment support
- Performance testing integration
- Multi-server deployment support

### Tools to Consider
- Kubernetes deployment
- Advanced monitoring solutions
- A/B testing platform
- Compliance automation
- Infrastructure as Code

## Support

For questions or issues with the CI/CD pipeline:

1. Check this documentation
2. Review workflow logs
3. Consult the team
4. Create an issue with detailed information

## Related Documentation

- [Docker Configuration](../README.md#docker)
- [Environment Variables](../.env.production.example)
- [Security Guidelines](SECURITY.md)
- [Deployment Guide](DEPLOYMENT.md)