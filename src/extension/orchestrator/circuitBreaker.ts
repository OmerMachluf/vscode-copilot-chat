/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker interface for protecting against cascading failures
 */
export interface ICircuitBreaker {
	readonly state: CircuitState;
	readonly failureCount: number;
	readonly lastFailureTime: number | undefined;

	recordSuccess(): void;
	recordFailure(): void;
	canExecute(): boolean;
	reset(): void;
}

/**
 * Configuration for the circuit breaker
 */
interface CircuitBreakerConfig {
	/** Number of consecutive failures before opening the circuit (default: 3) */
	failureThreshold: number;
	/** Time in ms to wait before transitioning from open to half-open (default: 30 seconds) */
	resetTimeoutMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
	failureThreshold: 3,
	resetTimeoutMs: 30 * 1000, // 30 seconds
};

/**
 * Circuit breaker implementation
 *
 * States:
 * - closed: Normal operation, requests flow through
 * - open: Circuit is tripped, requests are blocked
 * - half-open: Testing if service has recovered, allows one request through
 */
export class CircuitBreaker implements ICircuitBreaker {
	private _state: CircuitState = 'closed';
	private _failureCount = 0;
	private _lastFailureTime: number | undefined;
	private readonly _config: CircuitBreakerConfig;

	constructor(config: Partial<CircuitBreakerConfig> = {}) {
		this._config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Get the current state of the circuit breaker
	 * Handles automatic transition from open to half-open after timeout
	 */
	public get state(): CircuitState {
		if (this._state === 'open' && this._lastFailureTime) {
			const elapsed = Date.now() - this._lastFailureTime;
			if (elapsed >= this._config.resetTimeoutMs) {
				this._state = 'half-open';
			}
		}
		return this._state;
	}

	/**
	 * Get the current failure count
	 */
	public get failureCount(): number {
		return this._failureCount;
	}

	/**
	 * Get the timestamp of the last failure
	 */
	public get lastFailureTime(): number | undefined {
		return this._lastFailureTime;
	}

	/**
	 * Record a successful operation
	 * - In closed state: resets failure count
	 * - In half-open state: closes the circuit
	 */
	public recordSuccess(): void {
		if (this._state === 'half-open') {
			// Successful test, close the circuit
			this._state = 'closed';
		}
		this._failureCount = 0;
	}

	/**
	 * Record a failed operation
	 * - In closed state: increments failure count, may open circuit
	 * - In half-open state: opens the circuit immediately
	 */
	public recordFailure(): void {
		this._failureCount++;
		this._lastFailureTime = Date.now();

		if (this._state === 'half-open') {
			// Failed test, re-open the circuit
			this._state = 'open';
		} else if (this._state === 'closed' && this._failureCount >= this._config.failureThreshold) {
			// Threshold exceeded, open the circuit
			this._state = 'open';
		}
	}

	/**
	 * Check if an operation can be executed
	 * - closed: always true
	 * - half-open: allows one request through
	 * - open: false (but checks if it's time to transition to half-open)
	 */
	public canExecute(): boolean {
		const currentState = this.state; // This may transition to half-open

		switch (currentState) {
			case 'closed':
				return true;
			case 'half-open':
				// Allow one request through to test recovery
				return true;
			case 'open':
				return false;
		}
	}

	/**
	 * Manually reset the circuit breaker to closed state
	 */
	public reset(): void {
		this._state = 'closed';
		this._failureCount = 0;
		this._lastFailureTime = undefined;
	}
}
