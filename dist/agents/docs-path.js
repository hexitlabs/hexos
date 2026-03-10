import fs from "node:fs";
import path from "node:path";
import { resolveHexOSPackageRoot } from "../infra/hexos-root.js";
export async function resolveHexOSDocsPath(params) {
    const workspaceDir = params.workspaceDir?.trim();
    if (workspaceDir) {
        const workspaceDocs = path.join(workspaceDir, "docs");
        if (fs.existsSync(workspaceDocs))
            return workspaceDocs;
    }
    const packageRoot = await resolveHexOSPackageRoot({
        cwd: params.cwd,
        argv1: params.argv1,
        moduleUrl: params.moduleUrl,
    });
    if (!packageRoot)
        return null;
    const packageDocs = path.join(packageRoot, "docs");
    return fs.existsSync(packageDocs) ? packageDocs : null;
}
