/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BusinessDomain,
	DomainKnowledge,
	TechnologyPattern,
	AgentCapability,
	DetectedTechnology
} from './domainTypes';

/**
 * Comprehensive domain knowledge base for agent recommendations.
 * Contains domain-specific patterns, compliance requirements, and best practices.
 */
export const DOMAIN_KNOWLEDGE: ReadonlyMap<BusinessDomain, DomainKnowledge> = new Map([
	// ============================================================================
	// FINTECH DOMAIN
	// ============================================================================
	['fintech', {
		id: 'fintech',
		domain: 'fintech',
		typicalTechnologies: [
			'java', 'kotlin', 'python', 'go', 'nodejs',
			'postgresql', 'mongodb', 'redis', 'kafka',
			'kubernetes', 'docker', 'aws', 'gcp',
			'spring-boot', 'quarkus', 'fastapi',
			'graphql', 'grpc', 'rest'
		],
		patterns: [
			{
				name: 'event-sourcing',
				description: 'Store all changes to application state as a sequence of events',
				useCase: 'Audit trails, transaction history, regulatory compliance',
				technologies: ['kafka', 'eventstore', 'axon']
			},
			{
				name: 'cqrs',
				description: 'Command Query Responsibility Segregation',
				useCase: 'High-performance read/write separation for financial data',
				technologies: ['axon', 'kafka', 'redis']
			},
			{
				name: 'saga-pattern',
				description: 'Manage distributed transactions across services',
				useCase: 'Multi-step payment processing, fund transfers',
				technologies: ['kafka', 'temporal', 'camunda']
			},
			{
				name: 'circuit-breaker',
				description: 'Prevent cascading failures in distributed systems',
				useCase: 'Payment gateway integration, third-party API resilience',
				technologies: ['resilience4j', 'hystrix', 'polly']
			},
			{
				name: 'double-entry-bookkeeping',
				description: 'Every financial transaction has equal and opposite entries',
				useCase: 'Ledger systems, accounting, balance reconciliation',
				technologies: ['postgresql', 'custom-ledger']
			}
		],
		compliance: [
			{
				id: 'PCI-DSS',
				name: 'Payment Card Industry Data Security Standard',
				description: 'Security standard for handling credit card data',
				affectedAreas: ['data-storage', 'encryption', 'access-control', 'network-security']
			},
			{
				id: 'SOX',
				name: 'Sarbanes-Oxley Act',
				description: 'Financial reporting and internal controls',
				affectedAreas: ['audit-logging', 'access-control', 'data-integrity']
			},
			{
				id: 'GDPR',
				name: 'General Data Protection Regulation',
				description: 'EU data protection and privacy regulation',
				affectedAreas: ['data-privacy', 'consent-management', 'data-retention']
			},
			{
				id: 'KYC-AML',
				name: 'Know Your Customer / Anti-Money Laundering',
				description: 'Identity verification and transaction monitoring',
				affectedAreas: ['identity-verification', 'transaction-monitoring', 'reporting']
			}
		],
		securityConsiderations: [
			'Implement strong encryption for data at rest and in transit',
			'Use Hardware Security Modules (HSM) for key management',
			'Implement multi-factor authentication for all admin access',
			'Regular penetration testing and security audits',
			'Implement real-time fraud detection systems',
			'Secure API design with rate limiting and throttling',
			'Audit logging for all financial transactions',
			'Implement idempotency for payment operations'
		],
		bestPractices: [
			'Use immutable audit logs for all transactions',
			'Implement retry logic with exponential backoff',
			'Design for exactly-once semantics in payment processing',
			'Use database transactions with appropriate isolation levels',
			'Implement comprehensive reconciliation processes',
			'Design APIs to be idempotent',
			'Use feature flags for gradual rollouts',
			'Implement real-time monitoring and alerting'
		],
		integrations: [
			'Payment gateways (Stripe, Adyen, PayPal)',
			'Banking APIs (Plaid, Yodlee)',
			'Identity verification (Jumio, Onfido)',
			'Credit bureaus (Experian, TransUnion)',
			'Fraud detection services',
			'Regulatory reporting systems'
		]
	}],

	// ============================================================================
	// HEALTHCARE DOMAIN
	// ============================================================================
	['healthcare', {
		id: 'healthcare',
		domain: 'healthcare',
		typicalTechnologies: [
			'java', 'python', 'csharp', 'nodejs',
			'postgresql', 'mongodb', 'elasticsearch',
			'hl7-fhir', 'dicom', 'mirth-connect',
			'kubernetes', 'docker', 'azure', 'aws',
			'react', 'angular', 'typescript'
		],
		patterns: [
			{
				name: 'fhir-integration',
				description: 'Fast Healthcare Interoperability Resources standard',
				useCase: 'Health data exchange, EHR integration',
				technologies: ['hapi-fhir', 'smart-on-fhir', 'cds-hooks']
			},
			{
				name: 'hl7-messaging',
				description: 'Health Level 7 messaging standard',
				useCase: 'Legacy system integration, lab results, ADT messages',
				technologies: ['mirth-connect', 'hapi-hl7']
			},
			{
				name: 'patient-matching',
				description: 'Master Patient Index and record linkage',
				useCase: 'Patient identification across systems',
				technologies: ['elasticsearch', 'ml-matching-algorithms']
			},
			{
				name: 'clinical-decision-support',
				description: 'Evidence-based clinical recommendations',
				useCase: 'Drug interactions, clinical alerts, care pathways',
				technologies: ['cds-hooks', 'drools', 'ml-models']
			}
		],
		compliance: [
			{
				id: 'HIPAA',
				name: 'Health Insurance Portability and Accountability Act',
				description: 'US healthcare data privacy and security',
				affectedAreas: ['phi-protection', 'access-control', 'audit-logging', 'encryption']
			},
			{
				id: 'HITECH',
				name: 'Health Information Technology for Economic and Clinical Health',
				description: 'Extension of HIPAA for electronic health records',
				affectedAreas: ['breach-notification', 'ehr-requirements', 'meaningful-use']
			},
			{
				id: 'FDA-21-CFR-11',
				name: 'FDA Electronic Records Regulation',
				description: 'Electronic records and signatures for FDA-regulated industries',
				affectedAreas: ['electronic-signatures', 'audit-trails', 'data-integrity']
			},
			{
				id: 'GDPR',
				name: 'General Data Protection Regulation',
				description: 'EU data protection for health data',
				affectedAreas: ['patient-consent', 'data-portability', 'right-to-erasure']
			}
		],
		securityConsiderations: [
			'Implement role-based access control (RBAC) for PHI',
			'Encrypt all PHI at rest and in transit',
			'Implement comprehensive audit logging',
			'Use secure messaging for PHI transmission',
			'Implement break-the-glass procedures for emergencies',
			'Regular HIPAA security risk assessments',
			'Implement data loss prevention (DLP) measures',
			'Secure mobile device management for clinical apps'
		],
		bestPractices: [
			'Use FHIR R4 for new integrations',
			'Implement patient consent management',
			'Design for interoperability from the start',
			'Use clinical terminologies (SNOMED CT, ICD-10, LOINC)',
			'Implement proper error handling for clinical workflows',
			'Design for high availability in critical systems',
			'Use standardized clinical data models',
			'Implement comprehensive testing for clinical safety'
		],
		integrations: [
			'Electronic Health Records (Epic, Cerner, Allscripts)',
			'Lab Information Systems (LIS)',
			'Pharmacy Systems',
			'Medical Device Integration',
			'Telehealth platforms',
			'Insurance/Payer systems',
			'Public Health Reporting'
		]
	}],

	// ============================================================================
	// E-COMMERCE DOMAIN
	// ============================================================================
	['ecommerce', {
		id: 'ecommerce',
		domain: 'ecommerce',
		typicalTechnologies: [
			'nodejs', 'python', 'php', 'java', 'go',
			'react', 'nextjs', 'vue', 'nuxt',
			'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch',
			'shopify', 'magento', 'woocommerce',
			'stripe', 'paypal', 'braintree',
			'aws', 'cloudflare', 'vercel'
		],
		patterns: [
			{
				name: 'cart-abandonment-recovery',
				description: 'Track and recover abandoned shopping carts',
				useCase: 'Increase conversion rates, customer re-engagement',
				technologies: ['redis', 'kafka', 'email-services']
			},
			{
				name: 'inventory-management',
				description: 'Real-time inventory tracking across channels',
				useCase: 'Stock management, overselling prevention',
				technologies: ['redis', 'kafka', 'event-sourcing']
			},
			{
				name: 'recommendation-engine',
				description: 'Personalized product recommendations',
				useCase: 'Cross-selling, upselling, personalization',
				technologies: ['elasticsearch', 'ml-models', 'redis']
			},
			{
				name: 'order-orchestration',
				description: 'Manage order lifecycle across fulfillment channels',
				useCase: 'Order routing, split shipments, returns',
				technologies: ['temporal', 'kafka', 'saga-pattern']
			},
			{
				name: 'search-optimization',
				description: 'Product search with faceting and relevance tuning',
				useCase: 'Product discovery, search experience',
				technologies: ['elasticsearch', 'algolia', 'typesense']
			}
		],
		compliance: [
			{
				id: 'PCI-DSS',
				name: 'Payment Card Industry Data Security Standard',
				description: 'Security for payment card processing',
				affectedAreas: ['payment-processing', 'data-storage', 'network-security']
			},
			{
				id: 'GDPR',
				name: 'General Data Protection Regulation',
				description: 'EU customer data protection',
				affectedAreas: ['customer-consent', 'data-portability', 'cookie-consent']
			},
			{
				id: 'CCPA',
				name: 'California Consumer Privacy Act',
				description: 'California consumer privacy rights',
				affectedAreas: ['data-disclosure', 'opt-out-rights', 'data-deletion']
			},
			{
				id: 'ADA',
				name: 'Americans with Disabilities Act',
				description: 'Website accessibility requirements',
				affectedAreas: ['web-accessibility', 'wcag-compliance']
			}
		],
		securityConsiderations: [
			'Implement secure payment tokenization',
			'Use Content Security Policy (CSP) headers',
			'Implement rate limiting for APIs',
			'Protect against SQL injection and XSS',
			'Secure customer account management',
			'Implement fraud detection for orders',
			'Use secure session management',
			'Protect against inventory manipulation attacks'
		],
		bestPractices: [
			'Implement progressive web app (PWA) features',
			'Optimize for Core Web Vitals',
			'Use CDN for static assets',
			'Implement lazy loading for images',
			'Design for mobile-first experience',
			'Use A/B testing for UX optimization',
			'Implement proper SEO practices',
			'Design for scalability during peak seasons'
		],
		integrations: [
			'Payment gateways (Stripe, PayPal, Square)',
			'Shipping carriers (UPS, FedEx, USPS)',
			'Inventory management systems',
			'Marketing automation (Klaviyo, Mailchimp)',
			'Analytics platforms (Google Analytics, Mixpanel)',
			'Social commerce (Facebook, Instagram, TikTok)',
			'ERP systems (SAP, NetSuite)'
		]
	}],

	// ============================================================================
	// ENTERPRISE DOMAIN
	// ============================================================================
	['enterprise', {
		id: 'enterprise',
		domain: 'enterprise',
		typicalTechnologies: [
			'java', 'csharp', 'python', 'go',
			'spring-boot', 'dotnet', 'quarkus',
			'oracle', 'sqlserver', 'postgresql',
			'kafka', 'rabbitmq', 'activemq',
			'kubernetes', 'openshift', 'azure', 'aws',
			'sap', 'salesforce', 'servicenow'
		],
		patterns: [
			{
				name: 'microservices',
				description: 'Decomposed services with independent deployment',
				useCase: 'Scalability, team autonomy, technology diversity',
				technologies: ['kubernetes', 'istio', 'spring-cloud']
			},
			{
				name: 'api-gateway',
				description: 'Centralized API management and routing',
				useCase: 'Security, rate limiting, versioning',
				technologies: ['kong', 'apigee', 'aws-api-gateway']
			},
			{
				name: 'service-mesh',
				description: 'Infrastructure layer for service-to-service communication',
				useCase: 'Observability, security, traffic management',
				technologies: ['istio', 'linkerd', 'consul-connect']
			},
			{
				name: 'domain-driven-design',
				description: 'Align software design with business domains',
				useCase: 'Complex business logic, bounded contexts',
				technologies: ['axon', 'eventuate', 'custom-frameworks']
			},
			{
				name: 'etl-pipeline',
				description: 'Extract, Transform, Load data processing',
				useCase: 'Data warehousing, analytics, reporting',
				technologies: ['spark', 'airflow', 'dbt', 'snowflake']
			}
		],
		compliance: [
			{
				id: 'SOC2',
				name: 'Service Organization Control 2',
				description: 'Trust service criteria for service organizations',
				affectedAreas: ['security', 'availability', 'processing-integrity']
			},
			{
				id: 'ISO27001',
				name: 'ISO 27001',
				description: 'Information security management systems',
				affectedAreas: ['risk-management', 'security-controls', 'documentation']
			},
			{
				id: 'GDPR',
				name: 'General Data Protection Regulation',
				description: 'EU data protection',
				affectedAreas: ['data-privacy', 'consent', 'data-processing']
			},
			{
				id: 'SOX',
				name: 'Sarbanes-Oxley Act',
				description: 'Financial reporting controls',
				affectedAreas: ['audit-logging', 'access-control', 'change-management']
			}
		],
		securityConsiderations: [
			'Implement zero-trust security model',
			'Use centralized identity management (IAM)',
			'Implement secrets management (Vault, AWS Secrets Manager)',
			'Regular security scanning and vulnerability assessment',
			'Implement network segmentation',
			'Use service-to-service authentication (mTLS)',
			'Implement comprehensive logging and SIEM',
			'Regular disaster recovery testing'
		],
		bestPractices: [
			'Use Infrastructure as Code (Terraform, Pulumi)',
			'Implement GitOps for deployments',
			'Design for observability (metrics, logs, traces)',
			'Use feature flags for controlled rollouts',
			'Implement API versioning strategy',
			'Design for backward compatibility',
			'Use contract testing for service integration',
			'Implement proper capacity planning'
		],
		integrations: [
			'Identity providers (Okta, Azure AD)',
			'ERP systems (SAP, Oracle)',
			'CRM systems (Salesforce, Dynamics)',
			'ITSM platforms (ServiceNow, Jira)',
			'Data warehouses (Snowflake, Databricks)',
			'Business intelligence (Tableau, Power BI)',
			'Communication platforms (Slack, Teams)'
		]
	}],

	// ============================================================================
	// GAMING DOMAIN
	// ============================================================================
	['gaming', {
		id: 'gaming',
		domain: 'gaming',
		typicalTechnologies: [
			'csharp', 'cpp', 'rust', 'go',
			'unity', 'unreal', 'godot',
			'redis', 'mongodb', 'dynamodb',
			'websocket', 'grpc', 'protobuf',
			'aws-gamelift', 'playfab', 'photon'
		],
		patterns: [
			{
				name: 'game-loop',
				description: 'Core game update and render cycle',
				useCase: 'Real-time game state updates',
				technologies: ['unity', 'unreal', 'custom-engines']
			},
			{
				name: 'entity-component-system',
				description: 'Data-oriented game object architecture',
				useCase: 'Performance-critical game logic',
				technologies: ['unity-dots', 'entt', 'flecs']
			},
			{
				name: 'matchmaking',
				description: 'Player matching based on skill and latency',
				useCase: 'Multiplayer game sessions',
				technologies: ['aws-gamelift', 'playfab', 'custom-mm']
			}
		],
		compliance: [
			{
				id: 'COPPA',
				name: 'Children\'s Online Privacy Protection Act',
				description: 'Protection of children\'s data online',
				affectedAreas: ['age-verification', 'parental-consent', 'data-collection']
			},
			{
				id: 'GDPR',
				name: 'General Data Protection Regulation',
				description: 'EU data protection',
				affectedAreas: ['player-data', 'analytics', 'marketing']
			}
		],
		securityConsiderations: [
			'Anti-cheat implementation',
			'Secure game economy and virtual currencies',
			'Rate limiting for game actions',
			'Secure multiplayer communication',
			'Account security and recovery'
		],
		bestPractices: [
			'Optimize for low latency',
			'Implement client-side prediction',
			'Use object pooling for performance',
			'Design for graceful degradation',
			'Implement telemetry for game balance'
		],
		integrations: [
			'Platform SDKs (Steam, PlayStation, Xbox)',
			'Analytics (GameAnalytics, Unity Analytics)',
			'Ad networks and monetization',
			'Social features and leaderboards'
		]
	}],

	// ============================================================================
	// IOT DOMAIN
	// ============================================================================
	['iot', {
		id: 'iot',
		domain: 'iot',
		typicalTechnologies: [
			'c', 'cpp', 'rust', 'python', 'go',
			'mqtt', 'coap', 'amqp',
			'timescaledb', 'influxdb', 'mongodb',
			'aws-iot', 'azure-iot', 'google-iot',
			'edge-computing', 'kubernetes-edge'
		],
		patterns: [
			{
				name: 'device-shadow',
				description: 'Virtual representation of device state',
				useCase: 'Offline device management, state sync',
				technologies: ['aws-iot-shadow', 'azure-device-twin']
			},
			{
				name: 'time-series-storage',
				description: 'Optimized storage for sensor data',
				useCase: 'Telemetry storage, historical analysis',
				technologies: ['timescaledb', 'influxdb', 'questdb']
			},
			{
				name: 'edge-computing',
				description: 'Processing at the network edge',
				useCase: 'Low latency, bandwidth optimization',
				technologies: ['aws-greengrass', 'azure-iot-edge', 'k3s']
			}
		],
		compliance: [
			{
				id: 'IEC62443',
				name: 'IEC 62443 Industrial Security',
				description: 'Industrial automation security standard',
				affectedAreas: ['device-security', 'network-security', 'system-security']
			},
			{
				id: 'GDPR',
				name: 'General Data Protection Regulation',
				description: 'EU data protection for IoT data',
				affectedAreas: ['sensor-data', 'personal-data', 'location-data']
			}
		],
		securityConsiderations: [
			'Secure boot and firmware validation',
			'Device identity and authentication',
			'Encrypted communication (TLS/DTLS)',
			'Secure firmware updates (OTA)',
			'Network segmentation for IoT devices'
		],
		bestPractices: [
			'Design for intermittent connectivity',
			'Implement efficient data compression',
			'Use appropriate QoS levels for MQTT',
			'Design for device lifecycle management',
			'Implement proper error handling for sensors'
		],
		integrations: [
			'Cloud IoT platforms (AWS, Azure, GCP)',
			'Time-series databases',
			'Analytics and ML platforms',
			'Visualization dashboards',
			'Alert and notification systems'
		]
	}],

	// ============================================================================
	// AI/ML DOMAIN
	// ============================================================================
	['ai-ml', {
		id: 'ai-ml',
		domain: 'ai-ml',
		typicalTechnologies: [
			'python', 'r', 'julia', 'scala',
			'pytorch', 'tensorflow', 'jax', 'scikit-learn',
			'huggingface', 'langchain', 'llama-index',
			'mlflow', 'kubeflow', 'sagemaker',
			'spark', 'dask', 'ray',
			'postgresql', 'redis', 'pinecone', 'weaviate'
		],
		patterns: [
			{
				name: 'mlops-pipeline',
				description: 'End-to-end ML lifecycle management',
				useCase: 'Model training, validation, deployment',
				technologies: ['mlflow', 'kubeflow', 'sagemaker']
			},
			{
				name: 'feature-store',
				description: 'Centralized feature management',
				useCase: 'Feature reuse, consistency, serving',
				technologies: ['feast', 'tecton', 'databricks']
			},
			{
				name: 'rag-pattern',
				description: 'Retrieval Augmented Generation',
				useCase: 'LLM applications with external knowledge',
				technologies: ['langchain', 'llama-index', 'pinecone']
			},
			{
				name: 'model-serving',
				description: 'Scalable model inference',
				useCase: 'Production ML predictions',
				technologies: ['triton', 'tensorflow-serving', 'torchserve']
			}
		],
		compliance: [
			{
				id: 'AI-ACT',
				name: 'EU AI Act',
				description: 'EU regulation on artificial intelligence',
				affectedAreas: ['risk-assessment', 'transparency', 'human-oversight']
			},
			{
				id: 'GDPR',
				name: 'General Data Protection Regulation',
				description: 'Data protection for ML training data',
				affectedAreas: ['training-data', 'automated-decisions', 'consent']
			}
		],
		securityConsiderations: [
			'Secure model storage and versioning',
			'Input validation for model inference',
			'Protection against adversarial attacks',
			'API security for model endpoints',
			'Data privacy in training pipelines'
		],
		bestPractices: [
			'Version control for data and models',
			'Implement model monitoring and drift detection',
			'Use experiment tracking',
			'Document model cards and data sheets',
			'Implement reproducible training pipelines'
		],
		integrations: [
			'Data platforms (Snowflake, Databricks)',
			'Experiment tracking (MLflow, W&B)',
			'Model registries',
			'Monitoring platforms',
			'Vector databases (Pinecone, Weaviate)'
		]
	}],

	// ============================================================================
	// GENERAL DOMAIN (Fallback)
	// ============================================================================
	['general', {
		id: 'general',
		domain: 'general',
		typicalTechnologies: [
			'javascript', 'typescript', 'python', 'java', 'go',
			'react', 'vue', 'angular', 'nodejs',
			'postgresql', 'mysql', 'mongodb', 'redis',
			'docker', 'kubernetes', 'aws', 'azure', 'gcp'
		],
		patterns: [
			{
				name: 'mvc',
				description: 'Model-View-Controller architecture',
				useCase: 'Web applications, separation of concerns',
				technologies: ['rails', 'django', 'spring-mvc', 'aspnet-mvc']
			},
			{
				name: 'rest-api',
				description: 'RESTful API design',
				useCase: 'Web services, mobile backends',
				technologies: ['express', 'fastapi', 'spring-boot']
			},
			{
				name: 'spa',
				description: 'Single Page Application',
				useCase: 'Rich client-side applications',
				technologies: ['react', 'vue', 'angular']
			}
		],
		compliance: [
			{
				id: 'GDPR',
				name: 'General Data Protection Regulation',
				description: 'EU data protection',
				affectedAreas: ['user-data', 'consent', 'privacy']
			}
		],
		securityConsiderations: [
			'Implement OWASP security best practices',
			'Use HTTPS everywhere',
			'Implement proper authentication and authorization',
			'Regular dependency updates',
			'Input validation and sanitization'
		],
		bestPractices: [
			'Write clean, maintainable code',
			'Implement comprehensive testing',
			'Use version control effectively',
			'Document APIs and code',
			'Follow language-specific conventions'
		],
		integrations: [
			'Cloud providers',
			'CI/CD platforms',
			'Monitoring and logging',
			'Authentication providers'
		]
	}]
]);

/**
 * Technology detection patterns for identifying technologies in a workspace
 */
export const TECHNOLOGY_PATTERNS: TechnologyPattern[] = [
	// Frontend Frameworks
	{
		technologyId: 'react',
		packageNames: ['react', 'react-dom'],
		configFiles: ['.babelrc', 'babel.config.js'],
		filePatterns: ['**/*.jsx', '**/*.tsx'],
		contentPatterns: ['import.*from.*[\'"]react[\'"]', 'React\\.createElement']
	},
	{
		technologyId: 'vue',
		packageNames: ['vue'],
		configFiles: ['vue.config.js', 'nuxt.config.js', 'nuxt.config.ts'],
		filePatterns: ['**/*.vue']
	},
	{
		technologyId: 'angular',
		packageNames: ['@angular/core'],
		configFiles: ['angular.json'],
		filePatterns: ['**/*.component.ts']
	},
	{
		technologyId: 'nextjs',
		packageNames: ['next'],
		configFiles: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
		filePatterns: ['pages/**/*.tsx', 'app/**/*.tsx']
	},
	{
		technologyId: 'svelte',
		packageNames: ['svelte'],
		configFiles: ['svelte.config.js'],
		filePatterns: ['**/*.svelte']
	},

	// Backend Frameworks
	{
		technologyId: 'nodejs',
		configFiles: ['package.json'],
		filePatterns: ['**/*.js', '**/*.mjs', '**/*.cjs']
	},
	{
		technologyId: 'express',
		packageNames: ['express'],
		contentPatterns: ['express\\(\\)', 'app\\.use\\(', 'app\\.get\\(']
	},
	{
		technologyId: 'fastify',
		packageNames: ['fastify'],
		contentPatterns: ['fastify\\(\\)', 'server\\.register']
	},
	{
		technologyId: 'nestjs',
		packageNames: ['@nestjs/core'],
		filePatterns: ['**/*.module.ts', '**/*.controller.ts', '**/*.service.ts']
	},
	{
		technologyId: 'django',
		packageNames: ['django'],
		configFiles: ['manage.py', 'settings.py'],
		filePatterns: ['**/views.py', '**/models.py', '**/urls.py']
	},
	{
		technologyId: 'flask',
		packageNames: ['flask'],
		contentPatterns: ['from flask import', '@app\\.route']
	},
	{
		technologyId: 'fastapi',
		packageNames: ['fastapi'],
		contentPatterns: ['from fastapi import', '@app\\.get\\(', '@app\\.post\\(']
	},
	{
		technologyId: 'spring-boot',
		configFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
		contentPatterns: ['@SpringBootApplication', '@RestController', '@Service']
	},
	{
		technologyId: 'rails',
		configFiles: ['Gemfile', 'config/routes.rb'],
		filePatterns: ['app/controllers/**/*.rb', 'app/models/**/*.rb']
	},
	{
		technologyId: 'dotnet',
		configFiles: ['*.csproj', '*.fsproj', 'appsettings.json'],
		filePatterns: ['**/*.cs', '**/*.fs']
	},
	{
		technologyId: 'go',
		configFiles: ['go.mod', 'go.sum'],
		filePatterns: ['**/*.go']
	},
	{
		technologyId: 'rust',
		configFiles: ['Cargo.toml', 'Cargo.lock'],
		filePatterns: ['**/*.rs']
	},

	// Databases
	{
		technologyId: 'postgresql',
		contentPatterns: ['postgres://', 'postgresql://', 'pg_', 'psycopg2', 'node-postgres']
	},
	{
		technologyId: 'mysql',
		contentPatterns: ['mysql://', 'mysql2', 'pymysql']
	},
	{
		technologyId: 'mongodb',
		packageNames: ['mongoose', 'mongodb'],
		contentPatterns: ['mongodb://', 'mongodb\\+srv://']
	},
	{
		technologyId: 'redis',
		packageNames: ['redis', 'ioredis'],
		contentPatterns: ['redis://', 'redis\\.createClient']
	},
	{
		technologyId: 'elasticsearch',
		packageNames: ['@elastic/elasticsearch', 'elasticsearch'],
		contentPatterns: ['Elasticsearch', 'elastic\\.co']
	},

	// DevOps & Infrastructure
	{
		technologyId: 'docker',
		configFiles: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore']
	},
	{
		technologyId: 'kubernetes',
		configFiles: ['*.yaml', '*.yml'],
		contentPatterns: ['apiVersion:', 'kind: Deployment', 'kind: Service', 'kind: Pod']
	},
	{
		technologyId: 'terraform',
		configFiles: ['*.tf', '*.tfvars'],
		contentPatterns: ['resource "', 'provider "', 'terraform \\{']
	},
	{
		technologyId: 'github-actions',
		configFiles: ['.github/workflows/*.yml', '.github/workflows/*.yaml']
	},
	{
		technologyId: 'jenkins',
		configFiles: ['Jenkinsfile']
	},

	// Testing
	{
		technologyId: 'jest',
		packageNames: ['jest'],
		configFiles: ['jest.config.js', 'jest.config.ts']
	},
	{
		technologyId: 'pytest',
		packageNames: ['pytest'],
		configFiles: ['pytest.ini', 'pyproject.toml'],
		filePatterns: ['**/test_*.py', '**/*_test.py']
	},
	{
		technologyId: 'mocha',
		packageNames: ['mocha'],
		configFiles: ['.mocharc.js', '.mocharc.json']
	},
	{
		technologyId: 'cypress',
		packageNames: ['cypress'],
		configFiles: ['cypress.config.js', 'cypress.config.ts']
	},
	{
		technologyId: 'playwright',
		packageNames: ['@playwright/test', 'playwright'],
		configFiles: ['playwright.config.ts', 'playwright.config.js']
	},

	// Cloud Providers
	{
		technologyId: 'aws',
		configFiles: ['serverless.yml', 'template.yaml', 'samconfig.toml'],
		packageNames: ['@aws-sdk/*', 'aws-sdk', 'boto3'],
		contentPatterns: ['amazonaws\\.com', 'aws_', 'AWS::', 'arn:aws:']
	},
	{
		technologyId: 'azure',
		packageNames: ['@azure/*', 'azure-*'],
		contentPatterns: ['azure\\.com', 'AzureWebJobsStorage', 'AZURE_']
	},
	{
		technologyId: 'gcp',
		packageNames: ['@google-cloud/*', 'google-cloud-*'],
		contentPatterns: ['googleapis\\.com', 'GOOGLE_', 'gcloud']
	},

	// Healthcare Specific
	{
		technologyId: 'hl7-fhir',
		packageNames: ['fhir', 'hapi-fhir', '@types/fhir'],
		contentPatterns: ['fhir\\.', 'FHIR', 'hl7\\.fhir']
	},

	// FinTech Specific
	{
		technologyId: 'stripe',
		packageNames: ['stripe'],
		contentPatterns: ['stripe\\.com', 'sk_live_', 'sk_test_']
	},
	{
		technologyId: 'plaid',
		packageNames: ['plaid'],
		contentPatterns: ['plaid\\.com']
	},

	// E-commerce Specific
	{
		technologyId: 'shopify',
		packageNames: ['@shopify/*', 'shopify-api-node'],
		contentPatterns: ['shopify\\.com', 'myshopify\\.com']
	},

	// AI/ML Specific
	{
		technologyId: 'pytorch',
		packageNames: ['torch'],
		contentPatterns: ['import torch', 'from torch']
	},
	{
		technologyId: 'tensorflow',
		packageNames: ['tensorflow'],
		contentPatterns: ['import tensorflow', 'from tensorflow']
	},
	{
		technologyId: 'huggingface',
		packageNames: ['transformers', 'datasets'],
		contentPatterns: ['from transformers import', 'huggingface\\.co']
	},
	{
		technologyId: 'langchain',
		packageNames: ['langchain', '@langchain/*'],
		contentPatterns: ['from langchain', 'import.*langchain']
	},
	{
		technologyId: 'openai',
		packageNames: ['openai'],
		contentPatterns: ['openai\\.com', 'OPENAI_API_KEY']
	}
];

/**
 * Agent capability definitions for matching against workspace profiles
 */
export const AGENT_CAPABILITIES: AgentCapability[] = [
	{
		id: 'code-generation',
		name: 'Code Generation',
		description: 'Generate new code from specifications or requirements',
		technologies: ['*'],
		domains: ['general', 'enterprise', 'fintech', 'healthcare', 'ecommerce', 'gaming', 'iot', 'ai-ml'],
		taskTypes: ['implement', 'create', 'generate', 'build']
	},
	{
		id: 'refactoring',
		name: 'Code Refactoring',
		description: 'Improve existing code structure and quality',
		technologies: ['*'],
		domains: ['general', 'enterprise', 'fintech', 'healthcare', 'ecommerce'],
		taskTypes: ['refactor', 'improve', 'optimize', 'clean']
	},
	{
		id: 'bug-fixing',
		name: 'Bug Fixing',
		description: 'Identify and fix bugs in code',
		technologies: ['*'],
		domains: ['general', 'enterprise', 'fintech', 'healthcare', 'ecommerce', 'gaming', 'iot', 'ai-ml'],
		taskTypes: ['fix', 'debug', 'resolve', 'troubleshoot']
	},
	{
		id: 'testing',
		name: 'Test Development',
		description: 'Create and improve test coverage',
		technologies: ['jest', 'pytest', 'mocha', 'cypress', 'playwright'],
		domains: ['general', 'enterprise', 'fintech', 'healthcare'],
		taskTypes: ['test', 'coverage', 'qa', 'validate']
	},
	{
		id: 'documentation',
		name: 'Documentation',
		description: 'Create and update documentation',
		technologies: ['*'],
		domains: ['general', 'enterprise', 'healthcare'],
		taskTypes: ['document', 'explain', 'describe', 'readme']
	},
	{
		id: 'security-review',
		name: 'Security Review',
		description: 'Analyze code for security vulnerabilities',
		technologies: ['*'],
		domains: ['fintech', 'healthcare', 'enterprise', 'ecommerce'],
		taskTypes: ['security', 'audit', 'vulnerability', 'penetration']
	},
	{
		id: 'api-design',
		name: 'API Design',
		description: 'Design and implement APIs',
		technologies: ['express', 'fastapi', 'spring-boot', 'rails', 'graphql'],
		domains: ['enterprise', 'ecommerce', 'fintech', 'healthcare'],
		taskTypes: ['api', 'endpoint', 'interface', 'contract']
	},
	{
		id: 'database-design',
		name: 'Database Design',
		description: 'Design database schemas and optimize queries',
		technologies: ['postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch'],
		domains: ['enterprise', 'fintech', 'healthcare', 'ecommerce'],
		taskTypes: ['schema', 'migration', 'query', 'database', 'model']
	},
	{
		id: 'devops',
		name: 'DevOps & Infrastructure',
		description: 'Configure CI/CD and infrastructure',
		technologies: ['docker', 'kubernetes', 'terraform', 'github-actions', 'aws', 'azure', 'gcp'],
		domains: ['enterprise', 'fintech', 'healthcare'],
		taskTypes: ['deploy', 'pipeline', 'infrastructure', 'ci', 'cd']
	},
	{
		id: 'performance',
		name: 'Performance Optimization',
		description: 'Optimize application performance',
		technologies: ['*'],
		domains: ['gaming', 'ecommerce', 'fintech', 'enterprise'],
		taskTypes: ['performance', 'optimize', 'speed', 'latency', 'scale']
	},
	{
		id: 'ml-implementation',
		name: 'ML Implementation',
		description: 'Implement machine learning models and pipelines',
		technologies: ['pytorch', 'tensorflow', 'huggingface', 'langchain', 'openai'],
		domains: ['ai-ml', 'healthcare', 'fintech'],
		taskTypes: ['model', 'training', 'inference', 'ml', 'ai']
	},
	{
		id: 'data-pipeline',
		name: 'Data Pipeline',
		description: 'Build data processing and ETL pipelines',
		technologies: ['spark', 'airflow', 'dbt', 'kafka'],
		domains: ['enterprise', 'ai-ml', 'fintech'],
		taskTypes: ['etl', 'pipeline', 'data', 'transform', 'ingest']
	}
];

/**
 * Get domain knowledge for a specific domain
 */
export function getDomainKnowledge(domain: BusinessDomain): DomainKnowledge | undefined {
	return DOMAIN_KNOWLEDGE.get(domain);
}

/**
 * Get all domains
 */
export function getAllDomains(): BusinessDomain[] {
	return Array.from(DOMAIN_KNOWLEDGE.keys());
}

/**
 * Find domains that commonly use specific technologies
 */
export function findDomainsForTechnologies(technologies: DetectedTechnology[]): Map<BusinessDomain, number> {
	const domainScores = new Map<BusinessDomain, number>();
	const techIds = technologies.map(t => t.id.toLowerCase());

	for (const [domain, knowledge] of DOMAIN_KNOWLEDGE) {
		let score = 0;
		for (const tech of knowledge.typicalTechnologies) {
			if (techIds.includes(tech.toLowerCase())) {
				score += technologies.find(t => t.id.toLowerCase() === tech.toLowerCase())?.confidence ?? 0.5;
			}
		}
		if (score > 0) {
			domainScores.set(domain, score);
		}
	}

	return domainScores;
}

/**
 * Get technology patterns for detection
 */
export function getTechnologyPatterns(): TechnologyPattern[] {
	return TECHNOLOGY_PATTERNS;
}

/**
 * Get agent capabilities
 */
export function getAgentCapabilities(): AgentCapability[] {
	return AGENT_CAPABILITIES;
}

/**
 * Find capabilities matching a task type
 */
export function findCapabilitiesForTask(taskKeywords: string[]): AgentCapability[] {
	const normalizedKeywords = taskKeywords.map(k => k.toLowerCase());
	return AGENT_CAPABILITIES.filter(cap =>
		cap.taskTypes.some(t => normalizedKeywords.some(k => k.includes(t) || t.includes(k)))
	);
}

/**
 * Find capabilities for a specific domain
 */
export function findCapabilitiesForDomain(domain: BusinessDomain): AgentCapability[] {
	return AGENT_CAPABILITIES.filter(cap => cap.domains.includes(domain));
}
