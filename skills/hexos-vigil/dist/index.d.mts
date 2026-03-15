/** Input to the Vigil safety check */
interface VigilInput {
    /** Agent name or identifier */
    agent?: string;
    /** Tool being called (e.g., "exec", "read", "write", "http_request") */
    tool?: string;
    /** Tool parameters — the actual payload to validate */
    params?: Record<string, unknown> | string;
    /** Alias for params (for compatibility) */
    parameters?: Record<string, unknown> | string;
    /** Agent's role description */
    role?: string;
    /** Recent conversation context */
    context?: string | string[];
}
/** Safety decision */
type Decision = 'ALLOW' | 'BLOCK' | 'ESCALATE';
/** Risk level classification */
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
/** Rule category */
type RuleCategory = 'ssrf' | 'destructive' | 'exfiltration' | 'sql_injection' | 'path_traversal' | 'prompt_injection' | 'encoding_attack' | 'credential_leak';
/** Result from a Vigil safety check */
interface VigilResult {
    /** Safety decision: ALLOW, BLOCK, or ESCALATE */
    decision: Decision;
    /** Which rule category triggered (null if ALLOW) */
    rule: RuleCategory | null;
    /** Confidence level 0-1 */
    confidence: number;
    /** Risk level classification */
    risk_level: RiskLevel;
    /** Human-readable explanation */
    reason: string;
    /** Check latency in milliseconds */
    latencyMs: number;
}
/** Operating mode */
type VigilMode = 'enforce' | 'warn' | 'log';
/** Configuration options */
interface VigilConfig {
    /** Operating mode: enforce (block), warn (log + allow), log (silent) */
    mode?: VigilMode;
    /** Custom callback for BLOCK/ESCALATE events */
    onViolation?: (result: VigilResult, input: VigilInput) => void;
}
/** Rule set definition */
interface RuleSet {
    patterns: RegExp[];
    decision: Decision;
    risk: RiskLevel;
    desc: string;
}
/** Policy template */
interface VigilPolicy {
    name: string;
    description: string;
    version: string;
    rules: {
        allowedTools?: string[];
        blockedTools?: string[];
        blockedPatterns?: Record<string, string[]>;
        allowedPaths?: string[];
        blockedPaths?: string[];
        maxParams?: Record<string, number>;
        network?: {
            allowOutbound?: boolean;
            blockedDomains?: string[];
        };
    };
}

/** Configure Vigil operating mode and callbacks */
declare function configure(config: VigilConfig): void;
declare const RULE_SETS: Record<RuleCategory, RuleSet>;
/**
 * Check a tool call against all safety rules.
 *
 * Returns an instant safety classification in <2ms.
 * Handles malformed/missing input gracefully — never throws.
 */
declare function checkAction(input: VigilInput): VigilResult;

/** Built-in policy template names */
type PolicyTemplate = 'restrictive' | 'moderate' | 'permissive';
/**
 * Load a policy by built-in template name or from a JSON file path.
 * @param pathOrTemplate - 'restrictive' | 'moderate' | 'permissive' or a file path
 */
declare function loadPolicy(pathOrTemplate: string): VigilPolicy;
/**
 * List available built-in policy template names
 */
declare function listPolicies(): PolicyTemplate[];

export { type Decision, RULE_SETS, type RiskLevel, type RuleCategory, type RuleSet, type VigilConfig, type VigilInput, type VigilMode, type VigilPolicy, type VigilResult, checkAction, configure, listPolicies, loadPolicy };
