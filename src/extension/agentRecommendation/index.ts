/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Agent Recommendation Module
 *
 * This module provides intelligent agent recommendations based on:
 * - Workspace analysis (technologies, patterns, structure)
 * - Business domain detection (FinTech, Healthcare, E-commerce, Enterprise, etc.)
 * - Task context analysis
 * - User preferences
 *
 * Key Components:
 * - `IAgentRecommendationService`: Service interface for recommendations
 * - `AgentRecommendationEngine`: Core recommendation logic
 * - `CustomInstructionGenerator`: Generates context-aware instructions
 * - `DomainKnowledgeBase`: Domain-specific patterns and best practices
 */

// Export everything from node (includes common)
export * from './node/index';
