#!/usr/bin/env python3
"""
GoMeet Cost Calculation Script for 500 Participants Scale
This script validates and provides detailed breakdown of infrastructure costs
"""

import json
from datetime import datetime
from typing import Dict, List, Tuple

class GoMeetCostCalculator:
    def __init__(self):
        # DigitalOcean Pricing (Singapore Region 2024)
        self.pricing = {
            'instances': {
                'large': {'vcpu': 16, 'ram': 64, 'price': 334},    # 16 vCPU, 64GB RAM
                'medium': {'vcpu': 8, 'ram': 32, 'price': 167},    # 8 vCPU, 32GB RAM
                'small': {'vcpu': 4, 'ram': 16, 'price': 84},      # 4 vCPU, 16GB RAM
                'xsmall': {'vcpu': 2, 'ram': 8, 'price': 42},     # 2 vCPU, 8GB RAM
                'micro': {'vcpu': 1, 'ram': 4, 'price': 21},       # 1 vCPU, 4GB RAM
            },
            'storage': {
                'block_storage': 0.10,  # per GB per month
                'bandwidth': {
                    'first_100tb': 0.01,
                    'next_400tb': 0.009,
                    'above_500tb': 0.008,
                }
            },
            'load_balancer': 20,  # per month
            'cdn': 0.02,  # per GB
        }
        
        # Infrastructure Configuration
        self.infrastructure = {
            'livekit_sfu': {
                'nodes': 25,
                'instance_type': 'large',
                'storage_gb': 200,
                'auto_scaling_min': 15,
                'auto_scaling_max': 50,
            },
            'api_services': {
                'auth_service': {'replicas': 8, 'instance_type': 'small'},
                'meeting_service': {'replicas': 12, 'instance_type': 'small'},
                'signaling_service': {'replicas': 25, 'instance_type': 'medium'},
                'chat_service': {'replicas': 10, 'instance_type': 'xsmall'},
                'turn_service': {'replicas': 8, 'instance_type': 'xsmall'},
            },
            'database': {
                'primary': {'nodes': 1, 'instance_type': 'large', 'storage_gb': 2000},
                'replicas': {'nodes': 3, 'instance_type': 'large', 'storage_gb': 2000},
                'pgbouncer': {'nodes': 6, 'instance_type': 'xsmall'},
            },
            'redis': {
                'masters': {'nodes': 6, 'instance_type': 'medium', 'storage_gb': 500},
                'replicas': {'nodes': 6, 'instance_type': 'medium', 'storage_gb': 500},
            },
            'gateway': {
                'traefik': {'nodes': 6, 'instance_type': 'small'},
                'load_balancers': 3,
            },
            'monitoring': {
                'prometheus': {'nodes': 2, 'instance_type': 'medium', 'storage_gb': 500},
                'grafana': {'nodes': 3, 'instance_type': 'xsmall', 'storage_gb': 50},
                'alertmanager': {'nodes': 2, 'instance_type': 'micro', 'storage_gb': 20},
            }
        }
        
        # Team and operational costs
        self.operational_costs = {
            'team_salaries': {
                'backend_dev': {'count': 2, 'monthly_salary': 5000},
                'devops': {'count': 1, 'monthly_salary': 5000},
            },
            'marketing_sales': 5000,
            'operations_support': 3000,
        }
        
        # Bandwidth calculations
        self.bandwidth_requirements = {
            'participants_per_meeting': 500,
            'concurrent_meetings': 100,
            'active_speakers_ratio': 0.1,  # 10% active speakers
            'video_bitrate_mbps': 2,
            'audio_bitrate_kbps': 64,
            'peak_hours_per_day': 8,
            'days_per_month': 30,
            'overhead_factor': 1.3,  # 30% overhead
        }
        
        # Storage calculations
        self.storage_requirements = {
            'video_bitrate_mbps': 2,
            'participants_per_meeting': 500,
            'avg_meeting_duration_hours': 2,
            'concurrent_meetings': 100,
            'compression_ratio': 0.3,  # 70% compression
            'hot_storage_days': 30,
            'cold_storage_cost_per_gb': 0.004,  # S3 Glacier pricing
        }

    def calculate_instance_cost(self, instance_type: str, nodes: int) -> Dict:
        """Calculate monthly cost for instances"""
        instance = self.pricing['instances'][instance_type]
        monthly_cost = nodes * instance['price']
        
        return {
            'instance_type': instance_type,
            'nodes': nodes,
            'vcpu_total': nodes * instance['vcpu'],
            'ram_total_gb': nodes * instance['ram'],
            'monthly_cost': monthly_cost,
            'annual_cost': monthly_cost * 12
        }

    def calculate_storage_cost(self, storage_gb: float) -> Dict:
        """Calculate monthly storage cost"""
        monthly_cost = storage_gb * self.pricing['storage']['block_storage']
        
        return {
            'storage_gb': storage_gb,
            'monthly_cost': monthly_cost,
            'annual_cost': monthly_cost * 12
        }

    def calculate_livekit_sfu_cost(self) -> Dict:
        """Calculate LiveKit SFU cluster costs"""
        config = self.infrastructure['livekit_sfu']
        
        # Base cost
        base_cost = self.calculate_instance_cost(config['instance_type'], config['nodes'])
        
        # Storage cost
        storage_cost = self.calculate_storage_cost(config['storage_gb'] * config['nodes'])
        
        # Auto-scaling buffer (50% of base cost)
        auto_scaling_buffer = base_cost['monthly_cost'] * 0.5
        
        total_monthly = base_cost['monthly_cost'] + storage_cost['monthly_cost'] + auto_scaling_buffer
        
        return {
            'component': 'LiveKit SFU',
            'base_cost': base_cost,
            'storage_cost': storage_cost,
            'auto_scaling_buffer': auto_scaling_buffer,
            'total_monthly': total_monthly,
            'total_annual': total_monthly * 12
        }

    def calculate_api_services_cost(self) -> Dict:
        """Calculate API services costs"""
        config = self.infrastructure['api_services']
        services = []
        total_monthly = 0
        
        for service_name, service_config in config.items():
            cost = self.calculate_instance_cost(
                service_config['instance_type'], 
                service_config['replicas']
            )
            cost['service'] = service_name
            services.append(cost)
            total_monthly += cost['monthly_cost']
        
        return {
            'component': 'API Services',
            'services': services,
            'total_monthly': total_monthly,
            'total_annual': total_monthly * 12
        }

    def calculate_database_cost(self) -> Dict:
        """Calculate database layer costs"""
        config = self.infrastructure['database']
        
        # Primary database
        primary_cost = self.calculate_instance_cost(
            config['primary']['instance_type'], 
            config['primary']['nodes']
        )
        
        # Replicas
        replicas_cost = self.calculate_instance_cost(
            config['replicas']['instance_type'], 
            config['replicas']['nodes']
        )
        
        # PgBouncer
        pgbouncer_cost = self.calculate_instance_cost(
            config['pgbouncer']['instance_type'], 
            config['pgbouncer']['nodes']
        )
        
        # Storage costs
        total_storage = (config['primary']['storage_gb'] + 
                        config['replicas']['storage_gb'] * config['replicas']['nodes'])
        storage_cost = self.calculate_storage_cost(total_storage)
        
        total_monthly = (primary_cost['monthly_cost'] + replicas_cost['monthly_cost'] + 
                        pgbouncer_cost['monthly_cost'] + storage_cost['monthly_cost'])
        
        return {
            'component': 'Database Layer',
            'primary_cost': primary_cost,
            'replicas_cost': replicas_cost,
            'pgbouncer_cost': pgbouncer_cost,
            'storage_cost': storage_cost,
            'total_monthly': total_monthly,
            'total_annual': total_monthly * 12
        }

    def calculate_redis_cost(self) -> Dict:
        """Calculate Redis cluster costs"""
        config = self.infrastructure['redis']
        
        # Masters
        masters_cost = self.calculate_instance_cost(
            config['masters']['instance_type'], 
            config['masters']['nodes']
        )
        
        # Replicas
        replicas_cost = self.calculate_instance_cost(
            config['replicas']['instance_type'], 
            config['replicas']['nodes']
        )
        
        # Storage costs
        total_storage = (config['masters']['storage_gb'] * config['masters']['nodes'] + 
                        config['replicas']['storage_gb'] * config['replicas']['nodes'])
        storage_cost = self.calculate_storage_cost(total_storage)
        
        total_monthly = masters_cost['monthly_cost'] + replicas_cost['monthly_cost'] + storage_cost['monthly_cost']
        
        return {
            'component': 'Redis Cluster',
            'masters_cost': masters_cost,
            'replicas_cost': replicas_cost,
            'storage_cost': storage_cost,
            'total_monthly': total_monthly,
            'total_annual': total_monthly * 12
        }

    def calculate_gateway_cost(self) -> Dict:
        """Calculate API gateway costs"""
        config = self.infrastructure['gateway']
        
        # Traefik instances
        traefik_cost = self.calculate_instance_cost(
            config['traefik']['instance_type'], 
            config['traefik']['nodes']
        )
        
        # Load balancers
        lb_cost = config['load_balancers'] * self.pricing['load_balancer']
        
        total_monthly = traefik_cost['monthly_cost'] + lb_cost
        
        return {
            'component': 'API Gateway',
            'traefik_cost': traefik_cost,
            'load_balancer_cost': lb_cost,
            'total_monthly': total_monthly,
            'total_annual': total_monthly * 12
        }

    def calculate_monitoring_cost(self) -> Dict:
        """Calculate monitoring stack costs"""
        config = self.infrastructure['monitoring']
        
        components = []
        total_monthly = 0
        total_storage_monthly = 0
        
        for component_name, component_config in config.items():
            if 'nodes' in component_config:
                cost = self.calculate_instance_cost(
                    component_config['instance_type'], 
                    component_config['nodes']
                )
                cost['component_name'] = component_name
                components.append(cost)
                total_monthly += cost['monthly_cost']
            
            if 'storage_gb' in component_config:
                storage_cost = self.calculate_storage_cost(component_config['storage_gb'])
                storage_cost['component_name'] = component_name
                components.append(storage_cost)
                total_storage_monthly += storage_cost['monthly_cost']
        
        total_monthly += total_storage_monthly
        
        return {
            'component': 'Monitoring Stack',
            'components': components,
            'total_monthly': total_monthly,
            'total_annual': total_monthly * 12
        }

    def calculate_bandwidth_cost(self) -> Dict:
        """Calculate monthly bandwidth cost with realistic SFU assumptions"""
        req = self.bandwidth_requirements
        
        # Realistic SFU bandwidth calculation
        # Not all participants send video simultaneously - assume 10% active speakers
        active_speakers = int(req['participants_per_meeting'] * req['active_speakers_ratio'])
        
        # Each active participant sends 1 video stream at 1.5 Mbps (optimized)
        # SFU handles routing efficiently - no duplicate bandwidth for each receiver
        upload_bandwidth_mbps = active_speakers * 1.5  # Reduced bitrate
        
        # Each participant receives active streams + 1 screen share stream
        # With SFU optimization, bandwidth scales with active participants, not total
        receive_streams_per_participant = min(active_speakers + 1, 6)  # Cap at 6 streams
        download_bandwidth_per_participant = receive_streams_per_participant * 0.8  # Compressed bitrate
        
        # Total bandwidth calculation (SFU optimized)
        total_download_bandwidth = download_bandwidth_per_participant * req['participants_per_meeting']
        total_per_meeting_mbps = upload_bandwidth_mbps + total_download_bandwidth
        
        # Add audio bandwidth (much lower)
        audio_bandwidth_mbps = req['participants_per_meeting'] * req['audio_bitrate_kbps'] / 1000
        total_per_meeting_mbps += audio_bandwidth_mbps
        
        # Convert to GB per hour (1 Mbps = 0.45 GB per hour)
        gb_per_hour_per_meeting = total_per_meeting_mbps * 0.45
        
        # Assuming average meeting duration of 45 minutes
        gb_per_meeting = gb_per_hour_per_meeting * 0.75
        
        # Daily usage with realistic utilization
        # Assume 60% of meetings run at full capacity, others at 30%
        full_capacity_meetings = int(req['concurrent_meetings'] * 0.6)
        partial_capacity_meetings = req['concurrent_meetings'] - full_capacity_meetings
        
        daily_bandwidth_gb = (gb_per_meeting * full_capacity_meetings) + \
                           (gb_per_meeting * 0.3 * partial_capacity_meetings)
        
        # Monthly usage (22 business days, not 30)
        monthly_bandwidth_tb = (daily_bandwidth_gb * 22) / 1024
        
        # DigitalOcean bandwidth pricing: $0.01 per GB after first 1 TB
        # First 1 TB is free
        included_bandwidth_tb = 1
        chargeable_bandwidth_tb = max(0, monthly_bandwidth_tb - included_bandwidth_tb)
        
        # Calculate cost based on tiered pricing
        if monthly_bandwidth_tb <= 100:
            monthly_cost = monthly_bandwidth_tb * 1024 * self.pricing['storage']['bandwidth']['first_100tb']
        elif monthly_bandwidth_tb <= 500:
            cost_100tb = 100 * 1024 * self.pricing['storage']['bandwidth']['first_100tb']
            remaining_tb = monthly_bandwidth_tb - 100
            cost_remaining = remaining_tb * 1024 * self.pricing['storage']['bandwidth']['next_400tb']
            monthly_cost = cost_100tb + cost_remaining
        else:
            cost_100tb = 100 * 1024 * self.pricing['storage']['bandwidth']['first_100tb']
            cost_400tb = 400 * 1024 * self.pricing['storage']['bandwidth']['next_400tb']
            remaining_tb = monthly_bandwidth_tb - 500
            cost_remaining = remaining_tb * 1024 * self.pricing['storage']['bandwidth']['above_500tb']
            monthly_cost = cost_100tb + cost_400tb + cost_remaining
        
        return {
            'component': 'Bandwidth',
            'per_meeting_bandwidth_mbps': total_per_meeting_mbps,
            'peak_bandwidth_tb': monthly_bandwidth_tb * 0.6,  # Peak hours
            'off_peak_bandwidth_tb': monthly_bandwidth_tb * 0.4,  # Off-peak
            'total_bandwidth_tb': monthly_bandwidth_tb,
            'monthly_cost': monthly_cost,
            'annual_cost': monthly_cost * 12
        }

    def calculate_storage_requirements_cost(self) -> Dict:
        """Calculate storage costs for recordings with realistic assumptions"""
        req = self.storage_requirements
        
        # Realistic recording assumptions
        # Not all participants are recorded simultaneously - only active speakers + screen share
        active_streams_per_meeting = min(int(req['participants_per_meeting'] * 0.15), 8)  # Max 8 streams
        
        # Optimized recording bitrate (compressed for storage)
        recording_bitrate_mbps = 1.0  # Lower bitrate for recordings
        
        # Per meeting recording size (only record active streams, not all participants)
        per_hour_gb = recording_bitrate_mbps * 3600 / 8 / 1024  # Convert Mbps to GB per hour
        per_meeting_gb = per_hour_gb * active_streams_per_meeting * req['avg_meeting_duration_hours']
        
        # Daily storage requirements (22 business days, not all meetings recorded)
        recording_adoption_rate = 0.7  # 70% of meetings enable recording
        daily_meetings = int(req['concurrent_meetings'] * recording_adoption_rate)
        daily_storage_gb = per_meeting_gb * daily_meetings
        
        # With compression
        compressed_daily_storage_gb = daily_storage_gb * req['compression_ratio']
        
        # Hot storage (30 days for recent recordings)
        hot_storage_gb = compressed_daily_storage_gb * req['hot_storage_days']
        
        # Cold storage (11 months for older recordings)
        cold_storage_months = 11
        cold_storage_gb = compressed_daily_storage_gb * cold_storage_months * 30
        
        # Monthly costs
        hot_storage_cost = hot_storage_gb * self.pricing['storage']['block_storage']
        cold_storage_cost = cold_storage_gb * req['cold_storage_cost_per_gb']
        
        total_monthly = hot_storage_cost + cold_storage_cost
        
        return {
            'component': 'Storage (Recordings)',
            'per_meeting_gb': per_meeting_gb,
            'daily_storage_gb': daily_storage_gb,
            'compressed_daily_storage_gb': compressed_daily_storage_gb,
            'hot_storage_gb': hot_storage_gb,
            'cold_storage_gb': cold_storage_gb,
            'hot_storage_monthly_cost': hot_storage_cost,
            'cold_storage_monthly_cost': cold_storage_cost,
            'total_monthly': total_monthly,
            'total_annual': total_monthly * 12
        }

    def calculate_operational_costs(self) -> Dict:
        """Calculate monthly operational costs"""
        team_monthly = 0
        team_details = []
        
        for role, config in self.operational_costs['team_salaries'].items():
            monthly_cost = config['count'] * config['monthly_salary']
            team_monthly += monthly_cost
            team_details.append({
                'role': role,
                'count': config['count'],
                'monthly_salary': config['monthly_salary'],
                'monthly_cost': monthly_cost
            })
        
        total_monthly = (team_monthly + 
                        self.operational_costs['marketing_sales'] + 
                        self.operational_costs['operations_support'])
        
        return {
            'component': 'Operational Costs',
            'team_costs': team_details,
            'team_monthly': team_monthly,
            'marketing_sales': self.operational_costs['marketing_sales'],
            'operations_support': self.operational_costs['operations_support'],
            'total_monthly': total_monthly,
            'total_annual': total_monthly * 12
        }

    def calculate_total_infrastructure_cost(self) -> Dict:
        """Calculate total infrastructure costs"""
        components = [
            self.calculate_livekit_sfu_cost(),
            self.calculate_api_services_cost(),
            self.calculate_database_cost(),
            self.calculate_redis_cost(),
            self.calculate_gateway_cost(),
            self.calculate_monitoring_cost(),
            self.calculate_bandwidth_cost(),
            self.calculate_storage_requirements_cost()
        ]
        
        total_infrastructure_monthly = sum(comp.get('total_monthly', 0) for comp in components)
        
        # Add contingency (15%)
        contingency = total_infrastructure_monthly * 0.15
        
        total_with_contingency = total_infrastructure_monthly + contingency
        
        return {
            'components': components,
            'infrastructure_monthly': total_infrastructure_monthly,
            'contingency_monthly': contingency,
            'total_monthly': total_with_contingency,
            'total_annual': total_with_contingency * 12
        }

    def calculate_one_time_costs(self) -> Dict:
        """Calculate one-time implementation costs"""
        development_months = 4
        team_monthly_cost = (self.operational_costs['team_salaries']['backend_dev']['count'] * 
                           self.operational_costs['team_salaries']['backend_dev']['monthly_salary'] +
                           self.operational_costs['team_salaries']['devops']['count'] * 
                           self.operational_costs['team_salaries']['devops']['monthly_salary'])
        
        development_cost = team_monthly_cost * development_months
        
        return {
            'development': development_cost,
            'infrastructure_setup': 50000,
            'testing_qa': 30000,
            'marketing_launch': 50000,
            'total': development_cost + 50000 + 30000 + 50000
        }

    def generate_roi_analysis(self) -> Dict:
        """Generate ROI analysis with different scenarios"""
        pricing_tiers = {
            'basic': {'price': 10, 'max_participants': 50},
            'professional': {'price': 50, 'max_participants': 200},
            'enterprise': {'price': 200, 'max_participants': 500}
        }
        
        scenarios = {
            'conservative': {
                'year1_meetings_per_day': 100,
                'year2_meetings_per_day': 500,
                'year3_meetings_per_day': 1000,
                'enterprise_ratio': 0.2
            },
            'moderate': {
                'year1_meetings_per_day': 200,
                'year2_meetings_per_day': 1000,
                'year3_meetings_per_day': 2000,
                'enterprise_ratio': 0.25
            },
            'aggressive': {
                'year1_meetings_per_day': 500,
                'year2_meetings_per_day': 2000,
                'year3_meetings_per_day': 5000,
                'enterprise_ratio': 0.3
            }
        }
        
        operational_costs = self.calculate_operational_costs()
        infrastructure_costs = self.calculate_total_infrastructure_cost()
        total_monthly_burn = operational_costs['total_monthly'] + infrastructure_costs['total_monthly']
        
        roi_analysis = {}
        
        for scenario_name, scenario_config in scenarios.items():
            yearly_revenue = {}
            yearly_profit = {}
            
            for year in [1, 2, 3]:
                meetings_per_day = scenario_config[f'year{year}_meetings_per_day']
                enterprise_ratio = scenario_config['enterprise_ratio']
                
                # Calculate revenue distribution
                enterprise_meetings = meetings_per_day * enterprise_ratio
                professional_meetings = meetings_per_day * 0.3
                basic_meetings = meetings_per_day - enterprise_meetings - professional_meetings
                
                monthly_revenue = (enterprise_meetings * pricing_tiers['enterprise']['price'] +
                                 professional_meetings * pricing_tiers['professional']['price'] +
                                 basic_meetings * pricing_tiers['basic']['price']) * 30
                
                yearly_revenue[year] = monthly_revenue * 12
                yearly_profit[year] = yearly_revenue[year] - (total_monthly_burn * 12)
            
            # Calculate break-even point
            cumulative_profit = 0
            break_even_month = None
            one_time_costs = self.calculate_one_time_costs()['total']
            
            for month in range(1, 37):  # 3 years = 36 months
                if month <= 12:
                    monthly_profit = yearly_profit[1] / 12
                elif month <= 24:
                    monthly_profit = yearly_profit[2] / 12
                else:
                    monthly_profit = yearly_profit[3] / 12
                
                if month == 1:
                    cumulative_profit = monthly_profit - one_time_costs
                else:
                    cumulative_profit += monthly_profit
                
                if cumulative_profit > 0 and break_even_month is None:
                    break_even_month = month
                    break
            
            roi_analysis[scenario_name] = {
                'yearly_revenue': yearly_revenue,
                'yearly_profit': yearly_profit,
                'break_even_month': break_even_month,
                'total_3_year_profit': sum(yearly_profit.values()) - one_time_costs
            }
        
        return {
            'scenarios': roi_analysis,
            'monthly_burn': total_monthly_burn,
            'one_time_costs': self.calculate_one_time_costs()
        }

    def generate_cost_optimization_analysis(self) -> Dict:
        """Generate cost optimization analysis"""
        base_infrastructure_cost = self.calculate_total_infrastructure_cost()
        
        optimizations = {
            'reserved_instances': {
                'description': '30% discount for 1-year commitment',
                'savings_percentage': 0.30,
                'applicable_components': ['LiveKit SFU', 'API Services', 'Database Layer', 'Redis Cluster']
            },
            'spot_instances': {
                'description': '70% discount for non-critical services',
                'savings_percentage': 0.70,
                'applicable_components': ['Monitoring Stack', 'Development environments']
            },
            'storage_optimization': {
                'description': 'Compression and tiered storage',
                'savings_percentage': 0.50,
                'applicable_components': ['Storage (Recordings)']
            },
            'network_optimization': {
                'description': 'CDN integration and compression',
                'savings_percentage': 0.30,
                'applicable_components': ['Bandwidth']
            }
        }
        
        total_monthly_savings = 0
        optimization_details = []
        
        for opt_name, opt_config in optimizations.items():
            # Calculate applicable cost base
            applicable_cost = 0
            for component in base_infrastructure_cost['components']:
                if component['component'] in opt_config['applicable_components']:
                    applicable_cost += component.get('total_monthly', 0)
            
            monthly_savings = applicable_cost * opt_config['savings_percentage']
            total_monthly_savings += monthly_savings
            
            optimization_details.append({
                'optimization': opt_name,
                'description': opt_config['description'],
                'applicable_cost': applicable_cost,
                'savings_percentage': opt_config['savings_percentage'],
                'monthly_savings': monthly_savings,
                'annual_savings': monthly_savings * 12
            })
        
        optimized_monthly_cost = base_infrastructure_cost['total_monthly'] - total_monthly_savings
        
        return {
            'base_monthly_cost': base_infrastructure_cost['total_monthly'],
            'optimizations': optimization_details,
            'total_monthly_savings': total_monthly_savings,
            'optimized_monthly_cost': optimized_monthly_cost,
            'total_annual_savings': total_monthly_savings * 12
        }

    def generate_complete_report(self) -> Dict:
        """Generate complete cost analysis report"""
        return {
            'timestamp': datetime.now().isoformat(),
            'infrastructure_costs': self.calculate_total_infrastructure_cost(),
            'operational_costs': self.calculate_operational_costs(),
            'one_time_costs': self.calculate_one_time_costs(),
            'roi_analysis': self.generate_roi_analysis(),
            'cost_optimization': self.generate_cost_optimization_analysis(),
            'resource_summary': self.generate_resource_summary()
        }

    def generate_resource_summary(self) -> Dict:
        """Generate resource utilization summary"""
        total_vcpu = 0
        total_ram_gb = 0
        total_storage_gb = 0
        
        # Calculate from all components
        livekit = self.infrastructure['livekit_sfu']
        total_vcpu += livekit['nodes'] * self.pricing['instances'][livekit['instance_type']]['vcpu']
        total_ram_gb += livekit['nodes'] * self.pricing['instances'][livekit['instance_type']]['ram']
        total_storage_gb += livekit['nodes'] * livekit['storage_gb']
        
        # API services
        for service_config in self.infrastructure['api_services'].values():
            total_vcpu += service_config['replicas'] * self.pricing['instances'][service_config['instance_type']]['vcpu']
            total_ram_gb += service_config['replicas'] * self.pricing['instances'][service_config['instance_type']]['ram']
        
        # Database
        db_config = self.infrastructure['database']
        total_vcpu += (db_config['primary']['nodes'] + db_config['replicas']['nodes']) * self.pricing['instances'][db_config['primary']['instance_type']]['vcpu']
        total_ram_gb += (db_config['primary']['nodes'] + db_config['replicas']['nodes']) * self.pricing['instances'][db_config['primary']['instance_type']]['ram']
        total_storage_gb += db_config['primary']['storage_gb'] + (db_config['replicas']['storage_gb'] * db_config['replicas']['nodes'])
        total_vcpu += db_config['pgbouncer']['nodes'] * self.pricing['instances'][db_config['pgbouncer']['instance_type']]['vcpu']
        total_ram_gb += db_config['pgbouncer']['nodes'] * self.pricing['instances'][db_config['pgbouncer']['instance_type']]['ram']
        
        # Redis
        redis_config = self.infrastructure['redis']
        total_vcpu += (redis_config['masters']['nodes'] + redis_config['replicas']['nodes']) * self.pricing['instances'][redis_config['masters']['instance_type']]['vcpu']
        total_ram_gb += (redis_config['masters']['nodes'] + redis_config['replicas']['nodes']) * self.pricing['instances'][redis_config['masters']['instance_type']]['ram']
        total_storage_gb += (redis_config['masters']['storage_gb'] * redis_config['masters']['nodes'] + redis_config['replicas']['storage_gb'] * redis_config['replicas']['nodes'])
        
        # Gateway
        gateway_config = self.infrastructure['gateway']
        total_vcpu += gateway_config['traefik']['nodes'] * self.pricing['instances'][gateway_config['traefik']['instance_type']]['vcpu']
        total_ram_gb += gateway_config['traefik']['nodes'] * self.pricing['instances'][gateway_config['traefik']['instance_type']]['ram']
        
        # Monitoring
        monitoring_config = self.infrastructure['monitoring']
        for component_config in monitoring_config.values():
            if 'nodes' in component_config:
                total_vcpu += component_config['nodes'] * self.pricing['instances'][component_config['instance_type']]['vcpu']
                total_ram_gb += component_config['nodes'] * self.pricing['instances'][component_config['instance_type']]['ram']
            if 'storage_gb' in component_config:
                total_storage_gb += component_config['storage_gb']
        
        return {
            'total_vcpu': total_vcpu,
            'total_ram_gb': total_ram_gb,
            'total_storage_gb': total_storage_gb,
            'participant_capacity': 50000,
            'meetings_capacity': 100,
            'cost_per_participant_monthly': self.calculate_total_infrastructure_cost()['total_monthly'] / 50000,
            'cost_per_meeting_monthly': self.calculate_total_infrastructure_cost()['total_monthly'] / 100
        }

def main():
    """Main function to generate cost analysis report"""
    calculator = GoMeetCostCalculator()
    report = calculator.generate_complete_report()
    
    # Save report to JSON file
    with open('gomeet_cost_analysis.json', 'w') as f:
        json.dump(report, f, indent=2, default=str)
    
    # Print summary
    print("GoMeet Cost Analysis Report")
    print("=" * 50)
    print(f"Total Infrastructure Monthly Cost: ${report['infrastructure_costs']['total_monthly']:,.2f}")
    print(f"Total Operational Monthly Cost: ${report['operational_costs']['total_monthly']:,.2f}")
    print(f"Total Monthly Burn: ${report['infrastructure_costs']['total_monthly'] + report['operational_costs']['total_monthly']:,.2f}")
    print(f"One-Time Implementation Cost: ${report['one_time_costs']['total']:,.2f}")
    print(f"Potential Annual Savings: ${report['cost_optimization']['total_annual_savings']:,.2f}")
    
    print("\nROI Scenarios:")
    for scenario, data in report['roi_analysis']['scenarios'].items():
        print(f"  {scenario.capitalize()}: Break-even in {data['break_even_month']} months")
    
    print(f"\nResource Summary:")
    resources = report['resource_summary']
    print(f"  Total vCPU: {resources['total_vcpu']}")
    print(f"  Total RAM: {resources['total_ram_gb']}GB")
    print(f"  Total Storage: {resources['total_storage_gb']}GB")
    print(f"  Participant Capacity: {resources['participant_capacity']:,}")
    print(f"  Cost per Participant: ${resources['cost_per_participant_monthly']:.4f}")
    
    print(f"\nDetailed report saved to: gomeet_cost_analysis.json")

if __name__ == "__main__":
    main()