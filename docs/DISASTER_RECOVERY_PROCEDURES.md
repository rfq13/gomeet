# GoMeet Disaster Recovery Procedures

## Overview

> **📋 Navigation**: [← Back to Documentation Index](./README.md) | [Infrastructure](./INFRASTRUCTURE_DESIGN_500_PARTICIPANTS.md) | [Tasks](./task.md) | [Executive Summary](./EXECUTIVE_SUMMARY.md)

Dokumen ini berisi prosedur lengkap untuk disaster recovery infrastruktur GoMeet yang dirancang untuk 500 participants per meeting. Prosedur ini mencakup backup strategy, recovery scenarios, dan RTO/RPO targets.

## Recovery Time Objectives (RTO) & Recovery Point Objectives (RPO)

| Component     | RTO        | RPO        | Business Impact               |
| ------------- | ---------- | ---------- | ----------------------------- |
| LiveKit SFU   | 5 minutes  | 1 minute   | Critical - Video streaming    |
| API Services  | 10 minutes | 5 minutes  | Critical - Core functionality |
| PostgreSQL    | 30 minutes | 15 minutes | Critical - Data integrity     |
| Redis         | 5 minutes  | 1 minute   | Critical - Session management |
| Load Balancer | 2 minutes  | 0 minutes  | Critical - Traffic routing    |
| Monitoring    | 30 minutes | 15 minutes | High - Observability          |

## Backup Strategy

### 1. Database Backup Configuration

#### PostgreSQL Primary Database

```bash
#!/bin/bash
# postgres-backup.sh

# Configuration
BACKUP_DIR="/backups/postgresql"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PRIMARY_HOST="postgres-primary"
REPLICA_HOSTS=("postgres-replica-0" "postgres-replica-1")

# Create backup directory
mkdir -p $BACKUP_DIR

# Full backup from primary
pg_dump -h $PRIMARY_HOST -U postgres -d gomeet_primary \
  --format=custom \
  --compress=9 \
  --file=$BACKUP_DIR/gomeet_primary_$TIMESTAMP.dump

# Backup each shard
for shard in 1 2 3; do
  pg_dump -h $PRIMARY_HOST -U postgres -d gomeet_shard_$shard \
    --format=custom \
    --compress=9 \
    --file=$BACKUP_DIR/gomeet_shard_$shard_$TIMESTAMP.dump
done

# WAL archive backup
pg_receivewal -h $PRIMARY_HOST -U replicator \
  --directory=$BACKUP_DIR/wal_$TIMESTAMP \
  --compress=9 \
  --progress

# Verify backup integrity
for file in $BACKUP_DIR/*_$TIMESTAMP.dump; do
  pg_restore --list $file > /dev/null
  if [ $? -eq 0 ]; then
    echo "Backup verified: $file"
  else
    echo "Backup failed: $file"
    exit 1
  fi
done

# Clean old backups
find $BACKUP_DIR -name "*.dump" -mtime +$RETENTION_DAYS -delete
find $BACKUP_DIR -name "wal_*" -mtime +7 -delete

echo "PostgreSQL backup completed: $TIMESTAMP"
```

#### Redis Cluster Backup

```bash
#!/bin/bash
# redis-backup.sh

BACKUP_DIR="/backups/redis"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup each master node
MASTER_NODES=("redis-master-0" "redis-master-1" "redis-master-2")

for node in "${MASTER_NODES[@]}"; do
  # RDB snapshot
  redis-cli -h $node --rdb $BACKUP_DIR/${node}_$TIMESTAMP.rdb

  # AOF backup
  redis-cli -h $node BGREWRITEAOF
  sleep 10
  kubectl exec $node -n gomeet -- cat /data/appendonly.aof > $BACKUP_DIR/${node}_aof_$TIMESTAMP.aof
done

# Cluster configuration backup
redis-cli --cluster nodes > $BACKUP_DIR/cluster_nodes_$TIMESTAMP.txt

# Clean old backups
find $BACKUP_DIR -name "*.rdb" -mtime +$RETENTION_DAYS -delete
find $BACKUP_DIR -name "*.aof" -mtime +$RETENTION_DAYS -delete

echo "Redis backup completed: $TIMESTAMP"
```

### 2. Application State Backup

#### LiveKit SFU State

```bash
#!/bin/bash
# livekit-backup.sh

BACKUP_DIR="/backups/livekit"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Backup room configurations
kubectl get rooms.livekit.io -o yaml > $BACKUP_DIR/rooms_$TIMESTAMP.yaml

# Backup active sessions
curl -s http://livekit-sfu:7880/rooms | jq . > $BACKUP_DIR/active_rooms_$TIMESTAMP.json

# Backup configuration
kubectl get configmap livekit-config -o yaml > $BACKUP_DIR/config_$TIMESTAMP.yaml

echo "LiveKit backup completed: $TIMESTAMP"
```

### 3. Automated Backup Schedule

```yaml
# backup-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: gomeet
spec:
  schedule: "0 2 * * *" # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: postgres-backup
              image: postgres:15-alpine
              command:
                - /bin/bash
                - -c
                - |
                  # Mount backup script and execute
                  /scripts/postgres-backup.sh
              env:
                - name: PGPASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: gomeet-secrets
                      key: POSTGRES_PASSWORD
              volumeMounts:
                - name: backup-scripts
                  mountPath: /scripts
                - name: backup-storage
                  mountPath: /backups
          volumes:
            - name: backup-scripts
              configMap:
                name: backup-scripts
            - name: backup-storage
              persistentVolumeClaim:
                claimName: backup-storage
          restartPolicy: OnFailure
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: redis-backup
  namespace: gomeet
spec:
  schedule: "0 */6 * * *" # Every 6 hours
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: redis-backup
              image: redis:7.2-alpine
              command:
                - /bin/bash
                - -c
                - |
                  /scripts/redis-backup.sh
              volumeMounts:
                - name: backup-scripts
                  mountPath: /scripts
                - name: backup-storage
                  mountPath: /backups
          volumes:
            - name: backup-scripts
              configMap:
                name: backup-scripts
            - name: backup-storage
              persistentVolumeClaim:
                claimName: backup-storage
          restartPolicy: OnFailure
```

## Disaster Recovery Scenarios

### Scenario 1: Single Node Failure

#### LiveKit SFU Node Failure

**Detection:**

```bash
# Check pod status
kubectl get pods -n gomeet -l app=livekit-sfu

# Check for failed nodes
kubectl get pods -n gomeet -l app=livekit-sfu --field-selector=status.phase=Failed
```

**Recovery:**

```bash
# Automatic recovery via HPA and pod recreation
kubectl delete pod <failed-pod-name> -n gomeet

# Verify new pod is running
kubectl get pods -n gomeet -l app=livekit-sfu

# Check participant migration
curl -s http://livekit-sfu:7880/metrics | grep livekit_participants_total
```

**Rollback if needed:**

```bash
# Scale down to previous state
kubectl scale deployment livekit-sfu --replicas=8 -n gomeet

# Check logs for issues
kubectl logs -n gomeet deployment/livekit-sfu --tail=100
```

#### API Service Node Failure

**Detection:**

```bash
# Check service health
kubectl get pods -n gomeet -l component=api

# Check response times
curl -w "%{time_total}\n" -o /dev/null -s https://api.gomeet.com/health
```

**Recovery:**

```bash
# Restart unhealthy pods
kubectl rollout restart deployment/auth-service -n gomeet
kubectl rollout restart deployment/meeting-service -n gomeet
kubectl rollout restart deployment/signaling-service -n gomeet

# Verify health
kubectl rollout status deployment/auth-service -n gomeet
curl -f https://api.gomeet.com/api/v1/health
```

### Scenario 2: Database Failure

#### PostgreSQL Primary Failure

**Detection:**

```bash
# Check primary status
kubectl exec -it postgres-primary-0 -n gomeet -- pg_isready

# Check replica lag
kubectl exec postgres-replica-0 -n gomeet -- psql -U postgres -c "SELECT pg_last_wal_receive_lsn() - pg_last_wal_replay_lsn() AS lag_bytes;"
```

**Recovery - Promote Replica:**

```bash
# Step 1: Stop failed primary
kubectl scale deployment postgres-primary --replicas=0 -n gomeet

# Step 2: Promote replica to primary
kubectl exec postgres-replica-0 -n gomeet -- psql -U postgres -c "SELECT pg_promote();"

# Step 3: Update connection strings
kubectl patch service postgres-primary -n gomeet -p '{"spec":{"selector":{"app":"postgres","role":"primary"}}}'

# Step 4: Update replica configuration
kubectl patch deployment postgres-replica -n gomeet -p '{"spec":{"template":{"spec":{"containers":[{"name":"postgres","env":[{"name":"POSTGRES_PRIMARY_HOST","value":"postgres-replica-0"}]}]}}}}'

# Step 5: Scale new primary
kubectl scale deployment postgres-replica --replicas=1 -n gomeet
```

**Verification:**

```bash
# Test database connectivity
kubectl exec -it postgres-replica-0 -n gomeet -- psql -U postgres -d gomeet_primary -c "SELECT 1;"

# Check replication status
kubectl exec postgres-replica-1 -n gomeet -- psql -U postgres -c "SELECT * FROM pg_stat_replication;"
```

#### Point-in-Time Recovery

```bash
#!/bin/bash
# postgres-pitr.sh

BACKUP_TIMESTAMP="20231201_020000"
RECOVERY_TIME="2023-12-01 14:30:00"

# Step 1: Stop all database pods
kubectl scale deployment postgres-primary --replicas=0 -n gomeet
kubectl scale deployment postgres-replica --replicas=0 -n gomeet

# Step 2: Restore backup
kubectl exec -it postgres-primary-0 -n gomeet -- bash -c "
  pg_restore -U postgres -d gomeet_primary /backups/postgresql/gomeet_primary_$BACKUP_TIMESTAMP.dump
"

# Step 3: Configure recovery
kubectl exec -it postgres-primary-0 -n gomeet -- bash -c "
  echo 'restore_command = \"cp /backups/wal_%f %p\"' >> /var/lib/postgresql/data/recovery.conf
  echo 'recovery_target_time = \"$RECOVERY_TIME\"' >> /var/lib/postgresql/data/recovery.conf
  echo 'standby_mode = off' >> /var/lib/postgresql/data/recovery.conf
"

# Step 4: Start database
kubectl scale deployment postgres-primary --replicas=1 -n gomeet

# Step 5: Verify recovery
kubectl exec postgres-primary-0 -n gomeet -- psql -U postgres -c "SELECT now();"
```

### Scenario 3: Redis Cluster Failure

#### Master Node Failure

**Detection:**

```bash
# Check cluster status
kubectl exec redis-master-0 -n gomeet -- redis-cli cluster nodes

# Check for failed nodes
kubectl exec redis-master-0 -n gomeet -- redis-cli cluster nodes | grep fail
```

**Recovery:**

```bash
# Automatic failover should occur, but manual intervention if needed:
kubectl exec redis-master-0 -n gomeet -- redis-cli cluster failover

# Verify cluster state
kubectl exec redis-master-0 -n gomeet -- redis-cli cluster info

# Check data integrity
kubectl exec redis-master-0 -n gomeet -- redis-cli dbsize
```

#### Full Cluster Recovery

```bash
#!/bin/bash
# redis-cluster-recovery.sh

# Step 1: Stop all Redis pods
kubectl scale statefulset redis-master --replicas=0 -n gomeet
kubectl scale statefulset redis-replica --replicas=0 -n gomeet

# Step 2: Clear cluster configuration
kubectl exec redis-master-0 -n gomeet -- rm -f /data/nodes.conf

# Step 3: Start master nodes
kubectl scale statefulset redis-master --replicas=3 -n gomeet

# Step 4: Wait for masters to be ready
sleep 30

# Step 5: Initialize cluster
kubectl exec redis-master-0 -n gomeet -- redis-cli cluster init \
  $(kubectl get pods -n gomeet -l app=redis,role=master -o jsonpath='{range .items[*]}{.status.podIP}:6379 ')

# Step 6: Start replica nodes
kubectl scale statefulset redis-replica --replicas=3 -n gomeet

# Step 7: Add replicas to cluster
for i in {0..2}; do
  kubectl exec redis-replica-$i -n gomeet -- redis-cli cluster replicate \
    $(kubectl exec redis-master-$i -n gomeet -- redis-cli cluster nodes | grep myself | cut -d' ' -f1)
done

# Step 8: Verify cluster
kubectl exec redis-master-0 -n gomeet -- redis-cli cluster check
```

### Scenario 4: Complete Infrastructure Failure

#### Multi-Region Failover

```bash
#!/bin/bash
# multi-region-failover.sh

PRIMARY_REGION="singapore"
DR_REGION="jakarta"

# Step 1: Update DNS to point to DR region
# This would be done via your DNS provider API
# Example using Cloudflare API:
curl -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"content":"'$DR_REGION'.gomeet.com","type":"CNAME","name":"api.gomeet.com","ttl":60}'

# Step 2: Activate DR infrastructure
kubectl apply -f deployment/k8s/ -n gomeet-dr --context=dr-cluster

# Step 3: Restore latest backups to DR region
kubectl exec postgres-primary-0 -n gomeet-dr --context=dr-cluster -- bash -c "
  pg_restore -U postgres -d gomeet_primary /backups/postgresql/latest.dump
"

# Step 4: Start services in DR region
kubectl scale deployment --all --replicas=1 -n gomeet-dr --context=dr-cluster

# Step 5: Verify DR environment is healthy
kubectl get pods -n gomeet-dr --context=dr-cluster
curl -f https://jakarta.gomeet.com/health

echo "Failover to $DR_REGION completed"
```

## Emergency Response Procedures

### 1. Incident Declaration

**Severity Levels:**

- **SEV-0**: Complete system outage (>50% users affected)
- **SEV-1**: Major service degradation (>20% users affected)
- **SEV-2**: Minor service issues (<20% users affected)
- **SEV-3**: Low impact issues

**Incident Communication:**

```bash
#!/bin/bash
# declare-incident.sh

SEVERITY=$1
DESCRIPTION=$2
SLACK_WEBHOOK=$3

# Create incident in Slack
curl -X POST -H 'Content-type: application/json' \
  --data "{\"text\":\"🚨 SEV-$SEVERITY Incident Declared\n\nDescription: $DESCRIPTION\n\nOn-call team has been notified.\"}" \
  $SLACK_WEBHOOK

# Send SMS to on-call team
# Integration with your SMS provider
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT/Messages.json" \
  --data-urlencode "To=$ONCALL_PHONE" \
  --data-urlencode "From=$TWILIO_NUMBER" \
  --data-urlencode "Body=SEV-$SEVERITY: $DESCRIPTION"

# Create incident tracking ticket
# Integration with your ticketing system
curl -X POST "https://api.atlassian.com/jira/rest/api/2/issue" \
  -u "$JIRA_EMAIL:$JIRA_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "fields": {
      "project": { "key": "GM" },
      "summary": "SEV-'$SEVERITY' Incident: '$DESCRIPTION'",
      "description": "Incident declared at '$(date)'",
      "issuetype": { "name": "Incident" },
      "priority": { "name": "Highest" }
    }
  }'
```

### 2. War Room Setup

```bash
#!/bin/bash
# setup-war-room.sh

INCIDENT_ID=$1

# Create dedicated monitoring dashboard
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: war-room-dashboard
  namespace: gomeet
  labels:
    incident: $INCIDENT_ID
data:
  dashboard.json: |
    {
      "dashboard": {
        "title": "War Room - Incident $INCIDENT_ID",
        "panels": [
          {
            "title": "Error Rate",
            "type": "graph",
            "targets": [
              {
                "expr": "rate(http_requests_total{status=~\"5..\"}[5m])",
                "legendFormat": "5xx Errors"
              }
            ]
          },
          {
            "title": "Response Time",
            "type": "graph",
            "targets": [
              {
                "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
                "legendFormat": "95th percentile"
              }
            ]
          }
        ]
      }
    }
EOF

# Create incident namespace for isolated testing
kubectl create namespace incident-$INCIDENT_ID

# Deploy debugging tools
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: debugging-tools
  namespace: incident-$INCIDENT_ID
spec:
  replicas: 1
  selector:
    matchLabels:
      app: debugging-tools
  template:
    metadata:
      labels:
        app: debugging-tools
    spec:
      containers:
      - name: netshoot
        image: nicolaka/netshoot
        command: ["sleep", "3600"]
      - name: curl
        image: curlimages/curl
        command: ["sleep", "3600"]
      - name: redis-cli
        image: redis:7.2-alpine
        command: ["sleep", "3600"]
EOF

echo "War room setup completed for incident $INCIDENT_ID"
```

## Testing and Validation

### 1. Disaster Recovery Drills

#### Monthly Drill Schedule

```bash
#!/bin/bash
# monthly-drill.sh

DRILL_TYPE=$1  # "node-failure", "database-failover", "network-partition"

case $DRILL_TYPE in
  "node-failure")
    echo "Simulating node failure..."
    kubectl cordon $(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
    kubectl drain $(kubectl get nodes -o jsonpath='{.items[0].metadata.name}') --ignore-daemonsets --delete-emptydir-data
    ;;

  "database-failover")
    echo "Simulating database failover..."
    kubectl scale deployment postgres-primary --replicas=0 -n gomeet
    sleep 30
    kubectl exec postgres-replica-0 -n gomeet -- psql -U postgres -c "SELECT pg_promote();"
    ;;

  "network-partition")
    echo "Simulating network partition..."
    kubectl apply -f - <<EOF
apiVersion: v1
kind: NetworkPolicy
metadata:
  name: network-partition-drill
  namespace: gomeet
spec:
  podSelector:
    matchLabels:
      app: livekit-sfu
  policyTypes:
  - Egress
  egress: []
EOF
    ;;
esac

echo "Drill initiated. Monitor system behavior for 10 minutes..."
sleep 600

echo "Ending drill. Restoring normal operations..."
kubectl uncordon $(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
kubectl delete networkpolicy network-partition-drill -n gomeet
kubectl scale deployment postgres-primary --replicas=1 -n gomeet

echo "Drill completed. Review metrics and logs."
```

### 2. Recovery Validation Checklist

#### Node Recovery Validation

- [ ] Pod rescheduled successfully
- [ ] Service endpoints updated
- [ ] Load balancer health checks passing
- [ ] Application health checks passing
- [ ] No data loss detected
- [ ] Performance metrics within normal range

#### Database Recovery Validation

- [ ] Primary/replica roles correct
- [ ] Replication lag < 1 second
- [ ] Data integrity verified
- [ ] Connection pool functioning
- [ ] Query performance acceptable
- [ ] Backup consistency verified

#### Application Recovery Validation

- [ ] All services responding
- [ ] WebSocket connections established
- [ ] Video/audio streaming functional
- [ ] Chat system operational
- [ ] Authentication working
- [ ] Monitoring alerts resolved

## Post-Incident Procedures

### 1. Root Cause Analysis

```bash
#!/bin/bash
# rca-report.sh

INCIDENT_ID=$1
START_TIME=$2
END_TIME=$3

# Collect logs
kubectl logs --since=$START_TIME --until=$END_TIME -n gomeet --all-containers=true > /tmp/incident-$INCIDENT_ID-logs.txt

# Collect metrics
curl -G "http://prometheus:9090/api/v1/query_range" \
  --data-urlencode "query=rate(http_requests_total[5m])" \
  --data-urlencode "start=$START_TIME" \
  --data-urlencode "end=$END_TIME" \
  --data-urlencode "step=30s" > /tmp/incident-$INCIDENT_ID-metrics.json

# Generate report
cat <<EOF > /tmp/incident-$INCIDENT_ID-report.md
# Root Cause Analysis - Incident $INCIDENT_ID

## Timeline
- Start: $START_TIME
- End: $END_TIME
- Duration: $(date -d@$(( $(date -d $END_TIME +%s) - $(date -d $START_TIME +%s) )) -u +%H:%M:%S)

## Impact Analysis
[Generate from monitoring data]

## Root Cause
[Detailed analysis]

## Corrective Actions
[List of actions]

## Prevention Measures
[List of prevention strategies]

EOF

echo "RCA report generated: /tmp/incident-$INCIDENT_ID-report.md"
```

### 2. Improvement Actions

#### Technical Improvements

- Increase monitoring coverage
- Add automated recovery scripts
- Implement circuit breakers
- Enhance backup frequency
- Improve alerting thresholds

#### Process Improvements

- Update runbooks
- Conduct additional training
- Improve communication protocols
- Enhance documentation
- Schedule regular drills

## Contact Information

### Emergency Contacts

- **On-call DevOps**: +62-812-3456-7890
- **Engineering Manager**: +62-813-4567-8901
- **CTO**: +62-814-5678-9012

### Service Providers

- **DigitalOcean Support**: support@digitalocean.com
- **Cloudflare Support**: security@cloudflare.com
- **DNS Provider**: support@dns-provider.com

### Communication Channels

- **Slack**: #incidents, #engineering-alerts
- **Email**: incidents@gomeet.com
- **Status Page**: status.gomeet.com

## Conclusion

Disaster recovery procedures ini dirancang untuk memastikan:

1. **Minimal downtime** dengan RTO < 30 menit untuk critical services
2. **Data integrity** dengan RPO < 15 menit
3. **Automated recovery** untuk common failure scenarios
4. **Comprehensive testing** dengan monthly drills
5. **Continuous improvement** melalui post-incident analysis

Regular testing dan updating dari prosedur ini sangat penting untuk menjaga efektivitas disaster recovery strategy.

---

**📚 Related Documentation**:

- [Infrastructure Design](./INFRASTRUCTURE_DESIGN_500_PARTICIPANTS.md) - System architecture and components
- [Task Management](./task.md) - Implementation and operational procedures
- [Executive Summary](./EXECUTIVE_SUMMARY.md) - Business impact analysis
- [Cost Estimation](./COST_ESTIMATION_500_PARTICIPANTS.md) - Financial risk assessment
- [Documentation Index](./README.md) - Complete documentation overview
