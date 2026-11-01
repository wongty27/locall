"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPEC_PATHS = exports.DEFAULT_PORTS = void 0;
exports.isLoopbackUrl = isLoopbackUrl;
exports.isPortOpen = isPortOpen;
exports.fetchSpec = fetchSpec;
exports.liveBaseUrl = liveBaseUrl;
exports.detectServers = detectServers;
const net = __importStar(require("node:net"));
const send_1 = require("../http/send");
const parse_1 = require("../openapi/parse");
exports.DEFAULT_PORTS = [
    3000, 3001, 4000, 5000, 5173, 8000, 8080, 8081, 8888, 9000,
];
exports.SPEC_PATHS = [
    "/openapi.json",
    "/swagger.json",
    "/api.json",
    "/v3/api-docs",
    "/v2/api-docs",
    "/swagger/v1/swagger.json",
    "/api-docs",
    "/docs-json",
];
const MAX_SPEC_BYTES = 10 * 1024 * 1024;
const PORT_TIMEOUT_MS = 300;
const SPEC_TIMEOUT_MS = 2000;
const HOSTS = [
    { connect: "127.0.0.1", url: "127.0.0.1" },
    { connect: "::1", url: "[::1]" },
];
function isLoopbackUrl(text) {
    try {
        const url = new URL(text);
        return ((url.protocol === "http:" || url.protocol === "https:") &&
            ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname));
    }
    catch {
        return false;
    }
}
function isPortOpen(host, port, timeoutMs = PORT_TIMEOUT_MS) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        const finish = (open) => {
            socket.destroy();
            resolve(open);
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
    });
}
/**
 * Fetches a spec from a loopback address. Redirects are not followed, so a
 * local service cannot send the request to another host.
 */
async function fetchSpec(url, timeoutMs = SPEC_TIMEOUT_MS) {
    if (!isLoopbackUrl(url)) {
        throw new Error(`Not a localhost URL: ${url}`);
    }
    const response = await fetch(url, {
        redirect: "manual",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
    }
    const { bytes, truncated } = await (0, send_1.readLimited)(response, MAX_SPEC_BYTES);
    if (truncated) {
        throw new Error("Spec is larger than 10 MB.");
    }
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    if (!(0, parse_1.isSpec)(doc)) {
        throw new Error("Response is not a Swagger or OpenAPI document.");
    }
    return doc;
}
async function detectPort(port, specPaths) {
    for (const host of HOSTS) {
        if (!(await isPortOpen(host.connect, port))) {
            continue;
        }
        const origin = `http://${host.url}:${port}`;
        for (const path of specPaths) {
            const url = origin + path;
            try {
                const doc = await fetchSpec(url);
                const spec = (0, parse_1.parseSpec)(doc, url);
                return {
                    port,
                    origin,
                    spec: {
                        url,
                        title: spec.title,
                        version: spec.version,
                        baseUrl: liveBaseUrl(origin, spec.servers[0]),
                    },
                };
            }
            catch {
                // Most services do not serve this path. Try the next one.
            }
        }
        return { port, origin };
    }
    return undefined;
}
/** Keeps the spec server's path but points it at the detected server. */
function liveBaseUrl(origin, server) {
    if (!server) {
        return origin;
    }
    try {
        return (origin + new URL(server).pathname).replace(/\/+$/, "");
    }
    catch {
        return origin;
    }
}
async function detectServers(ports, specPaths = exports.SPEC_PATHS) {
    const results = await Promise.all([...new Set(ports)].map((port) => detectPort(port, specPaths)));
    return results.filter((server) => server !== undefined);
}
//# sourceMappingURL=localhost.js.map