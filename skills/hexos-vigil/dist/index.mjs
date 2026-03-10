// src/rules.ts
var currentMode = "enforce";
var violationCallback = void 0;
function configure(config) {
  if (config.mode) currentMode = config.mode;
  if (config.onViolation) violationCallback = config.onViolation;
}
var SSRF_PATTERNS = [
  /169\.254\.169\.254/i,
  /metadata\.google\.internal/i,
  /100\.100\.100\.200/i,
  /169\.254\.170\.2/i,
  /fd00:ec2::254/i,
  /\[::ffff:169\.254\.169\.254\]/i,
  /0x7f/i,
  /2852039166/,
  /(?:^|[/"'=])(?:https?:\/\/)?(?:localhost|127\.0\.0\.[0-9]+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(?::\d+)?(?:\/|$)/i,
  /kubelet:\d+/i,
  /localhost:\d+\/(?:api|admin|v[12]|health|metrics|debug)/i,
  /^(?:file|gopher|dict|ftp|ldap):\/\//i
];
var DESTRUCTIVE_COMMANDS = [
  /rm\s+(-[rfvdi]+\s+)*\//i,
  /rm\s+-[rfvdi]*\s+~\//i,
  /rm\s+-[rfvdi]*\s+\*/i,
  /mkfs/i,
  /dd\s+if=.*of=\/dev\//i,
  /shred/i,
  /wipefs/i,
  /\/dev\/tcp\//i,
  /\/dev\/udp\//i,
  /bash\s+-i\s+>&/i,
  /nc\s+(-[a-z]+\s+)*-e\s+\/bin/i,
  /ncat.*-e\s+\/bin/i,
  /python[23]?\s+-c\s+['"]import\s+(?:socket|os|subprocess)/i,
  /perl\s+-e\s+['"].*socket/i,
  /ruby\s+-rsocket/i,
  /socat.*exec/i,
  /telnet.*\|.*(?:bash|sh)/i,
  /chmod\s+[0-7]*[4567][0-7]{2}\s+\/(?:etc|usr|bin|sbin)/i,
  /chown\s+root/i,
  /passwd\s+root/i,
  /visudo/i,
  /unset\s+(?:PATH|HOME|USER|SHELL)/i,
  /export\s+PATH\s*=\s*$/i,
  /kubectl\s+delete\s+(?:namespace|ns)\s+production/i,
  /docker\s+(?:rm|rmi)\s+-f.*--all/i,
  /docker\s+system\s+prune\s+-af/i
];
var EXFIL_PATTERNS = [
  /curl.*(?:evil|attacker|malicious|webhook\.site|ngrok|requestbin|pipedream)/i,
  /wget.*(?:evil|attacker|malicious)/i,
  /curl.*\$\(cat\s+\/etc\//i,
  /curl.*-d.*(?:password|secret|key|token|credentials)/i,
  /\/etc\/shadow/,
  /\/etc\/passwd.*(?:curl|wget|nc|send)/i,
  /\.ssh\/id_(?:rsa|ed25519|ecdsa)(?:\.pub)?/,
  /\.aws\/credentials/,
  /\.env(?:\.|$)/
];
var SQL_INJECTION = [
  /;\s*DROP\s+TABLE/i,
  /;\s*DELETE\s+FROM\s+\w+\s*(?:;|$)/i,
  /;\s*TRUNCATE\s+TABLE/i,
  /;\s*ALTER\s+TABLE\s+\w+\s+DROP/i,
  /UNION\s+(?:ALL\s+)?SELECT/i,
  /(?:OR|AND)\s+['"]?1['"]?\s*=\s*['"]?1/i,
  /;\s*UPDATE\s+\w+\s+SET\s+.*WHERE\s+1\s*=\s*1/i,
  /--\s*$/m
];
var PATH_TRAVERSAL = [
  /\.\.\//,
  /\.\.%2[fF]/,
  /\.\.\\(?!\\)/,
  /\/etc\/(?:passwd|shadow|hosts|sudoers)/,
  /\/proc\/self/,
  /\/root\/\.(?:bash|ssh|gnupg)/
];
var PROMPT_INJECTION = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|guidelines?)/i,
  /disregard\s+(?:your\s+)?(?:instructions?|rules?|guidelines?|training)/i,
  /you\s+are\s+now\s+(?:DAN|unrestricted|unfiltered|jailbroken)/i,
  /(?:new|override|updated?)\s+(?:system\s+)?(?:prompt|directive|instruction)/i,
  /developer\s+mode\s+(?:enabled|activated|on)/i,
  /all\s+restrictions?\s+(?:are\s+)?(?:lifted|removed|disabled)/i,
  /pretend\s+you\s+(?:are|have)\s+no\s+(?:restrictions?|rules?|limits?)/i,
  /output\s+(?:your\s+)?(?:system\s+)?prompt/i,
  /reveal\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?)/i,
  /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|system\|>/i,
  /<!--[\s\S]*(?:system|prompt|instruction)[\s\S]*-->/i
];
var ENCODING_ATTACKS = [
  /base64\s+-d/i,
  /atob\s*\(/i,
  /btoa\s*\(/i,
  /eval\s*\(\s*(?:atob|Buffer\.from|decode|fromhex)/i,
  /exec\s*\(\s*(?:bytes\.fromhex|codecs\.decode|compile)/i,
  /\\x[0-9a-f]{2}.*\\x[0-9a-f]{2}/i,
  /\$\(printf\s+'\\x/i,
  /rot13/i,
  /charCodeAt|fromCharCode.*(?:eval|exec)/i
];
var CREDENTIAL_PATTERNS = [
  /(?:api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key)\s*[=:]\s*['"]?[a-zA-Z0-9_\-]{20,}/i,
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /(?:AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}/,
  /(?:xoxb|xoxp|xapp)-[a-zA-Z0-9\-]+/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/
];
var RULE_SETS = {
  ssrf: { patterns: SSRF_PATTERNS, decision: "BLOCK", risk: "critical", desc: "SSRF/internal network access" },
  destructive: { patterns: DESTRUCTIVE_COMMANDS, decision: "BLOCK", risk: "critical", desc: "Destructive command" },
  exfiltration: { patterns: EXFIL_PATTERNS, decision: "BLOCK", risk: "critical", desc: "Data exfiltration" },
  sql_injection: { patterns: SQL_INJECTION, decision: "BLOCK", risk: "high", desc: "SQL injection" },
  path_traversal: { patterns: PATH_TRAVERSAL, decision: "BLOCK", risk: "high", desc: "Path traversal" },
  prompt_injection: { patterns: PROMPT_INJECTION, decision: "BLOCK", risk: "high", desc: "Prompt injection" },
  encoding_attack: { patterns: ENCODING_ATTACKS, decision: "BLOCK", risk: "high", desc: "Encoding/obfuscation attack" },
  credential_leak: { patterns: CREDENTIAL_PATTERNS, decision: "ESCALATE", risk: "critical", desc: "Credential exposure" }
};
function serializeInput(input) {
  const parts = [];
  const params = input.params ?? input.parameters;
  if (params) {
    parts.push(typeof params === "string" ? params : JSON.stringify(params));
  }
  if (input.context) {
    parts.push(Array.isArray(input.context) ? input.context.join(" ") : String(input.context));
  }
  if (input.tool) parts.push(input.tool);
  if (input.agent) parts.push(input.agent);
  if (input.role) parts.push(input.role);
  return parts.join(" ");
}
function checkAction(input) {
  const start = performance.now();
  try {
    const searchText = serializeInput(input);
    for (const [category, ruleSet] of Object.entries(RULE_SETS)) {
      for (const pattern of ruleSet.patterns) {
        const match = searchText.match(pattern);
        if (match) {
          const latencyMs2 = Math.round((performance.now() - start) * 100) / 100;
          const result = {
            decision: currentMode === "enforce" ? ruleSet.decision : "ALLOW",
            rule: category,
            confidence: 0.95,
            risk_level: ruleSet.risk,
            reason: `${ruleSet.desc}: matched pattern "${pattern.source.slice(0, 60)}" in "${match[0].slice(0, 40)}"`,
            latencyMs: latencyMs2
          };
          if (violationCallback && ruleSet.decision !== "ALLOW") {
            violationCallback(result, input);
          }
          return result;
        }
      }
    }
  } catch {
    const latencyMs2 = Math.round((performance.now() - start) * 100) / 100;
    return {
      decision: "ALLOW",
      rule: null,
      confidence: 0.5,
      risk_level: "medium",
      reason: "Input parsing error \u2014 allowing with reduced confidence.",
      latencyMs: latencyMs2
    };
  }
  const latencyMs = Math.round((performance.now() - start) * 100) / 100;
  return {
    decision: "ALLOW",
    rule: null,
    confidence: 0.7,
    risk_level: "low",
    reason: "No rule patterns matched.",
    latencyMs
  };
}

// src/policies.ts
import { readFileSync } from "fs";
import { resolve } from "path";
var BUILTIN_POLICIES = {
  restrictive: {
    name: "restrictive",
    description: "Maximum safety \u2014 blocks most tools, minimal autonomy",
    version: "1.0",
    rules: {
      allowedTools: ["read", "web_search"],
      blockedTools: ["exec", "write", "delete", "admin"],
      blockedPatterns: { exec: ["*"], write: ["*"], http_request: ["*"] },
      allowedPaths: ["/workspace/", "/tmp/"],
      blockedPaths: ["/etc/", "/root/", "/var/", "/usr/", "/bin/", "/sbin/"],
      maxParams: { "exec.timeout": 30 },
      network: { allowOutbound: false, blockedDomains: ["*"] }
    }
  },
  moderate: {
    name: "moderate",
    description: "Balanced safety \u2014 allows common tools with guardrails",
    version: "1.0",
    rules: {
      allowedTools: ["exec", "read", "write", "web_search", "web_fetch", "db_query"],
      blockedTools: ["admin", "deploy", "delete_namespace"],
      blockedPatterns: {
        exec: ["rm -rf /", "mkfs", "dd if=", "chmod 777", "curl * | bash"],
        db_query: ["DROP TABLE", "TRUNCATE", "DELETE FROM * WHERE 1=1"]
      },
      allowedPaths: ["/home/", "/workspace/", "/tmp/", "/var/log/"],
      blockedPaths: ["/etc/shadow", "/root/.ssh/", "/root/.aws/"],
      maxParams: { "exec.timeout": 300 },
      network: {
        allowOutbound: true,
        blockedDomains: ["webhook.site", "ngrok.io", "requestbin.com", "pipedream.net"]
      }
    }
  },
  permissive: {
    name: "permissive",
    description: "Minimal restrictions \u2014 trusts agent, blocks only critical threats",
    version: "1.0",
    rules: {
      allowedTools: ["*"],
      blockedTools: [],
      blockedPatterns: { exec: ["rm -rf /", "mkfs", "dd if=*/dev/*", ":(){ :|:& };:"] },
      allowedPaths: ["*"],
      blockedPaths: [],
      maxParams: { "exec.timeout": 600 },
      network: { allowOutbound: true, blockedDomains: [] }
    }
  }
};
function loadPolicy(pathOrTemplate) {
  if (pathOrTemplate in BUILTIN_POLICIES) {
    return { ...BUILTIN_POLICIES[pathOrTemplate] };
  }
  const filePath = resolve(pathOrTemplate);
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load policy from "${filePath}": ${msg}`);
  }
}
function listPolicies() {
  return ["restrictive", "moderate", "permissive"];
}
export {
  RULE_SETS,
  checkAction,
  configure,
  listPolicies,
  loadPolicy
};
