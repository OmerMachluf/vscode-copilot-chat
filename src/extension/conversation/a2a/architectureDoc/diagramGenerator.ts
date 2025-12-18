/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Diagram generation for architecture documentation.
 *
 * This module generates mermaid diagrams from architecture models including
 * component diagrams, dependency graphs, class diagrams, and architecture overviews.
 */

import {
	DiagramType,
	IArchitectureComponent,
	IArchitectureLayer,
	IArchitectureModel,
	IArchitectureModule,
	IDiagramGenerator,
	IDiagramOptions,
	IGeneratedDiagram
} from './architectureTypes';

// ============================================================================
// Diagram Generator Implementation
// ============================================================================

/**
 * Implementation of the diagram generator service.
 */
export class DiagramGenerator implements IDiagramGenerator {

	/**
	 * Supported diagram types.
	 */
	private readonly supportedTypes: Set<DiagramType> = new Set([
		'component',
		'dependency',
		'class',
		'flowchart',
		'architecture',
		'module',
		'layer'
	]);

	/**
	 * Check if a diagram type is supported.
	 * @param type Diagram type
	 * @returns True if supported
	 */
	isSupported(type: DiagramType): boolean {
		return this.supportedTypes.has(type);
	}

	/**
	 * Generate a diagram from an architecture model.
	 * @param model Architecture model
	 * @param options Diagram options
	 * @returns Generated diagram
	 */
	generateDiagram(model: IArchitectureModel, options: IDiagramOptions): IGeneratedDiagram {
		switch (options.type) {
			case 'component':
				return this.generateComponentDiagram(model, options);
			case 'dependency':
				return this.generateDependencyDiagram(model, options);
			case 'class':
				return this.generateClassDiagram(model, options);
			case 'flowchart':
				return this.generateFlowchart(model, options);
			case 'architecture':
				return this.generateArchitectureDiagram(model, options);
			case 'module':
				return this.generateModuleDiagram(model, options);
			case 'layer':
				return this.generateLayerDiagram(model, options);
			default:
				return {
					type: options.type,
					code: `%% Diagram type '${options.type}' not supported`,
					format: 'mermaid',
					title: 'Unsupported Diagram',
					description: `The diagram type '${options.type}' is not currently supported.`
				};
		}
	}

	/**
	 * Generate all relevant diagrams for a model.
	 * @param model Architecture model
	 * @returns Array of generated diagrams
	 */
	generateAllDiagrams(model: IArchitectureModel): IGeneratedDiagram[] {
		const diagrams: IGeneratedDiagram[] = [];

		// Always generate architecture overview
		diagrams.push(this.generateArchitectureDiagram(model, { type: 'architecture' }));

		// Generate component diagram if components exist
		if (model.components.length > 0) {
			diagrams.push(this.generateComponentDiagram(model, { type: 'component' }));
			diagrams.push(this.generateDependencyDiagram(model, { type: 'dependency' }));
		}

		// Generate module diagram if modules exist
		if (model.modules.length > 0) {
			diagrams.push(this.generateModuleDiagram(model, { type: 'module' }));
		}

		// Generate layer diagram if layers exist
		if (model.layers.length > 0) {
			diagrams.push(this.generateLayerDiagram(model, { type: 'layer' }));
		}

		return diagrams;
	}

	/**
	 * Generate a component diagram.
	 */
	private generateComponentDiagram(model: IArchitectureModel, options: IDiagramOptions): IGeneratedDiagram {
		const direction = options.direction ?? 'TB';
		const maxNodes = options.maxNodes ?? 20;
		const showDetails = options.showDetails ?? true;

		let components = this.filterComponents(model.components, options);
		components = components.slice(0, maxNodes);

		const lines: string[] = [
			`graph ${direction}`,
			''
		];

		// Group by type if requested
		if (options.groupBy === 'type') {
			const byType = this.groupByType(components);

			for (const [type, comps] of Object.entries(byType)) {
				lines.push(`  subgraph ${this.sanitizeId(type)}["${this.formatTitle(type)}"]`);
				lines.push(`    direction ${direction}`);

				for (const comp of comps) {
					lines.push(`    ${this.generateComponentNode(comp, showDetails)}`);
				}

				lines.push('  end');
				lines.push('');
			}
		} else {
			// Flat list of components
			for (const comp of components) {
				lines.push(`  ${this.generateComponentNode(comp, showDetails)}`);
			}
			lines.push('');
		}

		// Add dependency edges
		for (const comp of components) {
			for (const depId of comp.dependencies) {
				const depComp = components.find(c => c.id === depId);
				if (depComp) {
					lines.push(`  ${this.sanitizeId(comp.id)} --> ${this.sanitizeId(depId)}`);
				}
			}
		}

		// Add styling
		lines.push('');
		lines.push('  %% Styling');
		lines.push('  classDef service fill:#e1f5fe,stroke:#01579b');
		lines.push('  classDef controller fill:#f3e5f5,stroke:#4a148c');
		lines.push('  classDef model fill:#e8f5e9,stroke:#1b5e20');
		lines.push('  classDef utility fill:#fff3e0,stroke:#e65100');
		lines.push('  classDef default fill:#fafafa,stroke:#424242');

		// Apply styles based on component types
		for (const comp of components) {
			const style = this.getComponentStyle(comp.type);
			if (style) {
				lines.push(`  class ${this.sanitizeId(comp.id)} ${style}`);
			}
		}

		return {
			type: 'component',
			code: lines.join('\n'),
			format: 'mermaid',
			title: options.title ?? 'Component Diagram',
			description: `Shows ${components.length} components and their relationships.`
		};
	}

	/**
	 * Generate a dependency diagram (graph).
	 */
	private generateDependencyDiagram(model: IArchitectureModel, options: IDiagramOptions): IGeneratedDiagram {
		const direction = options.direction ?? 'LR';
		const maxNodes = options.maxNodes ?? 30;

		let components = this.filterComponents(model.components, options);
		components = components.slice(0, maxNodes);

		const lines: string[] = [
			`graph ${direction}`,
			''
		];

		// Add nodes
		for (const comp of components) {
			const label = this.truncateLabel(comp.name, 25);
			lines.push(`  ${this.sanitizeId(comp.id)}["${label}"]`);
		}
		lines.push('');

		// Add edges with counts
		const edgeCounts = new Map<string, number>();

		for (const comp of components) {
			for (const depId of comp.dependencies) {
				if (components.find(c => c.id === depId)) {
					const edgeKey = `${comp.id}:${depId}`;
					edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1);
				}
			}
		}

		for (const [edgeKey, count] of edgeCounts) {
			const [from, to] = edgeKey.split(':');
			const thickness = count > 3 ? '==>' : count > 1 ? '-->' : '-.->';
			lines.push(`  ${this.sanitizeId(from)} ${thickness} ${this.sanitizeId(to)}`);
		}

		return {
			type: 'dependency',
			code: lines.join('\n'),
			format: 'mermaid',
			title: options.title ?? 'Dependency Graph',
			description: `Shows dependencies between ${components.length} components.`
		};
	}

	/**
	 * Generate a class diagram.
	 */
	private generateClassDiagram(model: IArchitectureModel, options: IDiagramOptions): IGeneratedDiagram {
		const maxNodes = options.maxNodes ?? 15;

		let components = this.filterComponents(model.components, options);
		components = components.slice(0, maxNodes);

		const lines: string[] = [
			'classDiagram',
			''
		];

		// Add classes
		for (const comp of components) {
			const className = this.sanitizeId(comp.name);
			lines.push(`  class ${className} {`);

			// Add type annotation
			lines.push(`    <<${comp.type}>>`);

			// Add key symbols (limited)
			const symbols = comp.symbols.slice(0, 5);
			for (const sym of symbols) {
				const visibility = sym.visibility === 'private' ? '-' : sym.visibility === 'internal' ? '#' : '+';
				if (sym.type === 'method' || sym.type === 'function') {
					lines.push(`    ${visibility}${sym.name}()`);
				} else {
					lines.push(`    ${visibility}${sym.name}`);
				}
			}

			if (comp.symbols.length > 5) {
				lines.push(`    +... ${comp.symbols.length - 5} more`);
			}

			lines.push('  }');
			lines.push('');
		}

		// Add relationships
		for (const comp of components) {
			const className = this.sanitizeId(comp.name);

			for (const depId of comp.dependencies) {
				const depComp = components.find(c => c.id === depId);
				if (depComp) {
					const depName = this.sanitizeId(depComp.name);
					lines.push(`  ${className} --> ${depName} : uses`);
				}
			}
		}

		return {
			type: 'class',
			code: lines.join('\n'),
			format: 'mermaid',
			title: options.title ?? 'Class Diagram',
			description: `Shows class structure for ${components.length} components.`
		};
	}

	/**
	 * Generate a flowchart.
	 */
	private generateFlowchart(model: IArchitectureModel, options: IDiagramOptions): IGeneratedDiagram {
		const direction = options.direction ?? 'TD';

		const lines: string[] = [
			`flowchart ${direction}`,
			'',
			'  %% Entry Points',
			'  Start([Start]) --> EntryPoints'
		];

		// Add entry points
		if (model.entryPoints.length > 0) {
			lines.push('  subgraph EntryPoints["Entry Points"]');
			for (const entry of model.entryPoints.slice(0, 5)) {
				const id = this.sanitizeId(entry);
				const label = this.truncateLabel(entry, 30);
				lines.push(`    ${id}["${label}"]`);
			}
			lines.push('  end');
		}

		// Add main flow through layers or components
		if (model.layers.length > 0) {
			lines.push('');
			lines.push('  %% Layers');
			let prevLayer: string | null = null;

			for (const layer of model.layers.sort((a, b) => a.order - b.order)) {
				const layerId = this.sanitizeId(layer.id);
				lines.push(`  ${layerId}[["${layer.name}"]]`);

				if (prevLayer) {
					lines.push(`  ${prevLayer} --> ${layerId}`);
				} else {
					lines.push(`  EntryPoints --> ${layerId}`);
				}

				prevLayer = layerId;
			}
		}

		return {
			type: 'flowchart',
			code: lines.join('\n'),
			format: 'mermaid',
			title: options.title ?? 'Application Flow',
			description: 'Shows the high-level flow through the application.'
		};
	}

	/**
	 * Generate a high-level architecture diagram.
	 */
	private generateArchitectureDiagram(model: IArchitectureModel, options: IDiagramOptions): IGeneratedDiagram {
		const direction = options.direction ?? 'TB';

		const lines: string[] = [
			`graph ${direction}`,
			'',
			`  title["${model.name}"]`,
			'  style title fill:none,stroke:none',
			''
		];

		// Group by layers if available
		if (model.layers.length > 0) {
			for (const layer of model.layers.sort((a, b) => a.order - b.order)) {
				lines.push(`  subgraph ${this.sanitizeId(layer.id)}["${layer.name}"]`);

				const layerComponents = model.components.filter(c =>
					layer.components.includes(c.id)
				);

				for (const comp of layerComponents.slice(0, 5)) {
					lines.push(`    ${this.sanitizeId(comp.id)}["${this.truncateLabel(comp.name, 20)}"]`);
				}

				if (layerComponents.length > 5) {
					lines.push(`    more_${this.sanitizeId(layer.id)}["+${layerComponents.length - 5} more"]`);
				}

				lines.push('  end');
				lines.push('');
			}
		} else if (model.modules.length > 0) {
			// Group by modules
			for (const mod of model.modules.slice(0, 6)) {
				lines.push(`  subgraph ${this.sanitizeId(mod.id)}["${mod.name}"]`);

				const moduleComponents = model.components.filter(c =>
					mod.components.includes(c.id)
				);

				for (const comp of moduleComponents.slice(0, 4)) {
					lines.push(`    ${this.sanitizeId(comp.id)}["${this.truncateLabel(comp.name, 20)}"]`);
				}

				lines.push('  end');
				lines.push('');
			}
		} else {
			// Just show top components by type
			const byType = this.groupByType(model.components);
			let count = 0;

			for (const [type, comps] of Object.entries(byType)) {
				if (count >= 4) break;

				lines.push(`  subgraph ${this.sanitizeId(type)}["${this.formatTitle(type)}"]`);

				for (const comp of comps.slice(0, 3)) {
					lines.push(`    ${this.sanitizeId(comp.id)}["${this.truncateLabel(comp.name, 20)}"]`);
				}

				lines.push('  end');
				lines.push('');
				count++;
			}
		}

		// Add key connections
		const connectionCount = 0;
		for (const comp of model.components.slice(0, 10)) {
			for (const depId of comp.dependencies.slice(0, 2)) {
				if (model.components.find(c => c.id === depId)) {
					lines.push(`  ${this.sanitizeId(comp.id)} -.-> ${this.sanitizeId(depId)}`);
				}
			}
			if (connectionCount >= 15) break;
		}

		// Add tech stack badges
		if (model.techStack.languages.length > 0) {
			lines.push('');
			lines.push('  subgraph tech["Technology Stack"]');
			for (const lang of model.techStack.languages.slice(0, 3)) {
				lines.push(`    ${this.sanitizeId(lang.name)}(("${lang.name}"))`);
			}
			lines.push('  end');
		}

		return {
			type: 'architecture',
			code: lines.join('\n'),
			format: 'mermaid',
			title: options.title ?? 'Architecture Overview',
			description: `High-level architecture of ${model.name}.`
		};
	}

	/**
	 * Generate a module diagram.
	 */
	private generateModuleDiagram(model: IArchitectureModel, options: IDiagramOptions): IGeneratedDiagram {
		const direction = options.direction ?? 'TB';
		const maxNodes = options.maxNodes ?? 15;

		let modules = model.modules;
		if (options.include) {
			modules = modules.filter(m => options.include!.includes(m.id));
		}
		if (options.exclude) {
			modules = modules.filter(m => !options.exclude!.includes(m.id));
		}
		modules = modules.slice(0, maxNodes);

		const lines: string[] = [
			`graph ${direction}`,
			''
		];

		// Add module nodes
		for (const mod of modules) {
			const label = this.truncateLabel(mod.name, 25);
			const componentCount = mod.components.length;
			lines.push(`  ${this.sanitizeId(mod.id)}["${label}<br/><small>${componentCount} components</small>"]`);
		}
		lines.push('');

		// Add parent-child relationships
		for (const mod of modules) {
			if (mod.parentModule) {
				const parent = modules.find(m => m.id === mod.parentModule);
				if (parent) {
					lines.push(`  ${this.sanitizeId(mod.parentModule)} --> ${this.sanitizeId(mod.id)}`);
				}
			}
		}

		// Add submodule relationships
		for (const mod of modules) {
			for (const subId of mod.subModules) {
				if (modules.find(m => m.id === subId)) {
					lines.push(`  ${this.sanitizeId(mod.id)} --> ${this.sanitizeId(subId)}`);
				}
			}
		}

		return {
			type: 'module',
			code: lines.join('\n'),
			format: 'mermaid',
			title: options.title ?? 'Module Structure',
			description: `Shows ${modules.length} modules and their relationships.`
		};
	}

	/**
	 * Generate a layer diagram.
	 */
	private generateLayerDiagram(model: IArchitectureModel, options: IDiagramOptions): IGeneratedDiagram {
		const layers = model.layers.sort((a, b) => a.order - b.order);

		const lines: string[] = [
			'graph TB',
			''
		];

		// Add layers as subgraphs
		for (const layer of layers) {
			const componentCount = layer.components.length;
			lines.push(`  subgraph ${this.sanitizeId(layer.id)}["${layer.name}"]`);
			lines.push(`    ${this.sanitizeId(layer.id)}_info["${componentCount} components"]`);
			lines.push('  end');
			lines.push('');
		}

		// Add dependency arrows between layers
		for (const layer of layers) {
			for (const depId of layer.allowedDependencies) {
				const depLayer = layers.find(l => l.id === depId);
				if (depLayer) {
					lines.push(`  ${this.sanitizeId(layer.id)} --> ${this.sanitizeId(depId)}`);
				}
			}
		}

		// Style based on layer order
		lines.push('');
		lines.push('  %% Layer styling');
		const colors = ['#e3f2fd', '#e8f5e9', '#fff3e0', '#fce4ec', '#f3e5f5'];

		for (let i = 0; i < layers.length; i++) {
			const color = colors[i % colors.length];
			lines.push(`  style ${this.sanitizeId(layers[i].id)} fill:${color}`);
		}

		return {
			type: 'layer',
			code: lines.join('\n'),
			format: 'mermaid',
			title: options.title ?? 'Architecture Layers',
			description: `Shows ${layers.length} architectural layers and their dependencies.`
		};
	}

	// ============================================================================
	// Helper Methods
	// ============================================================================

	/**
	 * Filter components based on options.
	 */
	private filterComponents(
		components: IArchitectureComponent[],
		options: IDiagramOptions
	): IArchitectureComponent[] {
		let result = components;

		if (options.include && options.include.length > 0) {
			result = result.filter(c => options.include!.includes(c.id));
		}

		if (options.exclude && options.exclude.length > 0) {
			result = result.filter(c => !options.exclude!.includes(c.id));
		}

		return result;
	}

	/**
	 * Group components by type.
	 */
	private groupByType(components: IArchitectureComponent[]): Record<string, IArchitectureComponent[]> {
		const result: Record<string, IArchitectureComponent[]> = {};

		for (const comp of components) {
			if (!result[comp.type]) {
				result[comp.type] = [];
			}
			result[comp.type].push(comp);
		}

		return result;
	}

	/**
	 * Generate a component node string.
	 */
	private generateComponentNode(comp: IArchitectureComponent, showDetails: boolean): string {
		const id = this.sanitizeId(comp.id);
		const label = this.truncateLabel(comp.name, 25);

		if (showDetails && comp.description) {
			const desc = this.truncateLabel(comp.description, 40);
			return `${id}["${label}<br/><small>${desc}</small>"]`;
		}

		return `${id}["${label}"]`;
	}

	/**
	 * Get style class for a component type.
	 */
	private getComponentStyle(type: string): string | null {
		const styleMap: Record<string, string> = {
			service: 'service',
			controller: 'controller',
			model: 'model',
			utility: 'utility',
			handler: 'controller',
			repository: 'service',
			middleware: 'service'
		};

		return styleMap[type] ?? null;
	}

	/**
	 * Sanitize an ID for use in mermaid.
	 */
	private sanitizeId(id: string): string {
		return id
			.replace(/[^a-zA-Z0-9]/g, '_')
			.replace(/^_+|_+$/g, '')
			.replace(/_+/g, '_');
	}

	/**
	 * Truncate a label to max length.
	 */
	private truncateLabel(text: string, maxLength: number): string {
		if (text.length <= maxLength) {
			return text;
		}
		return text.substring(0, maxLength - 3) + '...';
	}

	/**
	 * Format a type name as a title.
	 */
	private formatTitle(type: string): string {
		return type
			.replace(/([A-Z])/g, ' $1')
			.replace(/^./, str => str.toUpperCase())
			.trim();
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default diagram generator instance.
 */
export const diagramGenerator = new DiagramGenerator();
