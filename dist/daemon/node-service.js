import { resolveGatewayService } from "./service.js";
import { NODE_SERVICE_KIND, NODE_SERVICE_MARKER, NODE_WINDOWS_TASK_SCRIPT_NAME, resolveNodeLaunchAgentLabel, resolveNodeSystemdServiceName, resolveNodeWindowsTaskName, } from "./constants.js";
function withNodeServiceEnv(env) {
    return {
        ...env,
        HEXOS_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
        HEXOS_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
        HEXOS_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
        HEXOS_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
        HEXOS_LOG_PREFIX: "node",
        HEXOS_SERVICE_MARKER: NODE_SERVICE_MARKER,
        HEXOS_SERVICE_KIND: NODE_SERVICE_KIND,
    };
}
function withNodeInstallEnv(args) {
    return {
        ...args,
        env: withNodeServiceEnv(args.env),
        environment: {
            ...args.environment,
            HEXOS_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
            HEXOS_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
            HEXOS_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
            HEXOS_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
            HEXOS_LOG_PREFIX: "node",
            HEXOS_SERVICE_MARKER: NODE_SERVICE_MARKER,
            HEXOS_SERVICE_KIND: NODE_SERVICE_KIND,
        },
    };
}
export function resolveNodeService() {
    const base = resolveGatewayService();
    return {
        ...base,
        install: async (args) => {
            return base.install(withNodeInstallEnv(args));
        },
        uninstall: async (args) => {
            return base.uninstall({ ...args, env: withNodeServiceEnv(args.env) });
        },
        stop: async (args) => {
            return base.stop({ ...args, env: withNodeServiceEnv(args.env ?? {}) });
        },
        restart: async (args) => {
            return base.restart({ ...args, env: withNodeServiceEnv(args.env ?? {}) });
        },
        isLoaded: async (args) => {
            return base.isLoaded({ env: withNodeServiceEnv(args.env ?? {}) });
        },
        readCommand: (env) => base.readCommand(withNodeServiceEnv(env)),
        readRuntime: (env) => base.readRuntime(withNodeServiceEnv(env)),
    };
}
