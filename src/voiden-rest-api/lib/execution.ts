/**
 * REST API Execution — owned by the voiden-rest-api plugin.
 *
 * Contains all protocol-specific logic for building, sending, and parsing
 * REST HTTP requests/responses. Moved from core/request-engine/requestState.ts
 * so the plugin owns its own execution rather than baking it into core.
 *
 * These functions are the legacy direct-send path. The active pipeline path
 * goes through requestOrchestrator → sendRequestHybrid → Electron IPC.
 */

import { Buffer } from "buffer";

// ── Local type mirrors (avoids @/ path dependency in plugin build) ────────────

interface RequestParam {
  key: string;
  value: string;
  enabled: boolean;
}

interface BodyParam {
  key: string;
  value: string | File | any;
  type?: "text" | "file";
  enabled: boolean;
  fileName?: string;
}

interface Authorization {
  enabled: boolean;
  type: string;
  config: Record<string, any>;
}

interface RestRequest {
  method: string;
  url: string;
  headers: RequestParam[];
  params: RequestParam[];
  path_params?: RequestParam[];
  content_type?: string;
  body?: string;
  body_params?: BodyParam[];
  binary?: File | string | any;
  auth?: Authorization;
  preRequestResult?: any;
}

interface BaseResponse {
  statusCode: number;
  statusMessage: string;
  headers: any;
  contentType: string | null;
  elapsedTime: number;
  body: any;
  url: string;
  bytesContent?: number;
  error?: string | null;
  prerequestResult?: any;
  testRunnerResult?: any;
}

interface PreparedRequestState {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  queryParams: Array<{ key: string; value: string; enabled: boolean }>;
  pathParams: Array<{ key: string; value: string; enabled: boolean }>;
  body?: string;
  contentType?: string;
  bodyParams?: Array<{ key: string; value: any; type?: string; enabled: boolean }>;
  binary?: any;
  authProfile?: any;
  preRequestResult?: any;
  metadata?: Record<string, any>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function arrayObjectsToUrlEncodedString(array: Record<string, string>[]): string {
  return (
    array
      .map((obj) =>
        Object.entries(obj)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
          .join("&")
      )
      .join("&")
  );
}

/**
 * Merge auth credentials into the headers map, resolving env/process variables.
 */
export async function buildAuthHeaders(
  headers: RequestParam[],
  auth?: Authorization,
): Promise<Record<string, string>> {
  const authHeaders: Record<string, string> = {};

  if (auth?.enabled && auth.config) {
    switch (auth.type) {
      case "basic-auth": {
        let username = auth.config.username ?? "";
        let password = auth.config.password ?? "";
        try { username = await (window as any).electron?.env?.replaceVariables(username); } catch { }
        try {
          const { replaceProcessVariablesInText } = await import(/* @vite-ignore */ "@/core/request-engine/runtimeVariables" as any);
          username = await replaceProcessVariablesInText(username);
        } catch { }
        try { password = await (window as any).electron?.env?.replaceVariables(password); } catch { }
        try {
          const { replaceProcessVariablesInText } = await import(/* @vite-ignore */ "@/core/request-engine/runtimeVariables" as any);
          password = await replaceProcessVariablesInText(password);
        } catch { }
        authHeaders["Authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
        break;
      }
      case "bearer-token":
        authHeaders["Authorization"] = `Bearer ${auth.config.token}`;
        break;
      case "oauth2": {
        let headerPrefix = auth.config.headerPrefix || auth.config.tokenType || "Bearer";
        let accessToken = auth.config.accessToken;
        try { accessToken = await (window as any).electron?.env?.replaceVariables(accessToken); } catch { }
        try { headerPrefix = await (window as any).electron?.env?.replaceVariables(headerPrefix); } catch { }
        if (auth.config.addTokenTo !== "query") {
          authHeaders["Authorization"] = `${headerPrefix} ${accessToken}`;
        }
        break;
      }
      case "oauth": {
        authHeaders["Authorization"] = `Bearer ${auth.config.accessToken}`;
        break;
      }
      case "oauth1": {
        const parts: string[] = [];
        if (auth.config.consumerKey) parts.push(`oauth_consumer_key="${auth.config.consumerKey}"`);
        if (auth.config.token) parts.push(`oauth_token="${auth.config.token}"`);
        parts.push('oauth_signature_method="PLAINTEXT"');
        let signature = `${auth.config.consumerSecret ?? ""}&${auth.config.tokenSecret ?? ""}`;
        try { signature = await (window as any).electron?.env?.replaceVariables(signature); } catch { }
        parts.push(`oauth_signature="${encodeURIComponent(signature)}"`);
        parts.push(`oauth_timestamp="${Math.floor(Date.now() / 1000)}"`);
        parts.push(`oauth_nonce="${Math.random().toString(36).substring(2)}"`);
        parts.push('oauth_version="1.0"');
        authHeaders["Authorization"] = `OAuth ${parts.join(", ")}`;
        break;
      }
      case "api-key": {
        if (auth.config.in === "header") {
          authHeaders[auth.config.key] = auth.config.value;
        }
        break;
      }
    }
  }

  return headers
    .filter((h) => h.enabled)
    .reduce((acc: Record<string, string>, h) => {
      // Strip bare multipart/form-data — boundary must come from the native FormData
      if (h.key.toLowerCase() === "content-type" && h.value === "multipart/form-data") return acc;
      if (h.key && h.value) acc[h.key] = h.value;
      return acc;
    }, authHeaders);
}

/**
 * Build the query-string portion of a URL, including any auth query params.
 */
export function buildQueryString(params: RequestParam[], auth?: Authorization): string {
  let authQuery = "";
  if (auth?.enabled && auth.config) {
    if (auth.type === "api-key" && auth.config.in === "query") {
      authQuery = `${auth.config.key}=${auth.config.value}`;
    } else if (auth.type === "oauth2" && auth.config.addTokenTo === "query" && auth.config.accessToken) {
      authQuery = `access_token=${encodeURIComponent(auth.config.accessToken)}`;
    }
  }

  const filteredParams = params.filter((p) => p.enabled && (p.key || p.value));
  const queryString = filteredParams.map((p) => `${p.key}=${p.value}`).join("&");

  if (authQuery && queryString) return `?${authQuery}&${queryString}`;
  if (authQuery) return `?${authQuery}`;
  if (queryString) return `?${queryString}`;
  return "";
}

/**
 * Build the request body — handles JSON, XML, YAML, binary file, FormData,
 * URL-encoded form, returning the correct type for fetch.
 */
export function buildRestBody(
  contentType: string,
  body: string,
  bodyParams: BodyParam[],
  binary?: File | any,
): File | string | FormData | Buffer | null {
  const removeJsonComments = (json: string) =>
    json.replace(/("(?:\\.|[^"\\])*")|\/\/.*|\/\*[\s\S]*?\*\//g, (m, s) => (s ? m : ""));

  if (
    (contentType === "application/json" || contentType === "text/plain" || contentType === "text/html") &&
    body
  ) {
    return contentType === "application/json" ? removeJsonComments(body) : body;
  }

  if (typeof File !== "undefined" && binary instanceof File) return binary;
  if (Buffer.isBuffer(binary)) return binary;

  if (contentType === "multipart/form-data") {
    const formData = new FormData();
    bodyParams
      .filter((p) => p.enabled)
      .forEach((p) => {
        if (!p.value) return;
        if (p.value instanceof Uint8Array) {
          formData.append(p.key, new File([p.value.buffer as ArrayBuffer], p.fileName || "unknown"));
        } else if (p.value instanceof File) {
          formData.append(p.key, p.value);
        } else {
          formData.append(p.key, typeof p.value === "object" ? "" : p.value);
        }
      });
    return formData;
  }

  if (contentType === "application/x-www-form-urlencoded") {
    const data = bodyParams
      .filter((p) => p.enabled && p.value && !(p.value instanceof File))
      .map((p) => ({ key: p.key, value: p.value as string }));
    return data.length
      ? arrayObjectsToUrlEncodedString(data as Record<string, string>[])
      : "";
  }

  return null;
}

/**
 * Parse a fetch Response body into the appropriate JS value.
 */
export async function parseRestResponse(response: Response): Promise<Buffer | string | object | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";

  const isBinary =
    contentType.startsWith("image/") ||
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/") ||
    contentType.includes("pdf") ||
    contentType.includes("octet-stream") ||
    contentType.includes("zip") ||
    contentType.includes("gzip") ||
    contentType.includes("tar") ||
    contentType.includes("msword") ||
    contentType.includes("officedocument") ||
    contentType.includes("application/vnd") ||
    contentType.includes("application/x-") ||
    contentType.includes("font") ||
    contentType.includes("exe") ||
    contentType.includes("binary");

  if (isBinary) {
    const buffer = await (await response.blob()).arrayBuffer();
    return Buffer.from(buffer);
  }

  if (
    contentType.startsWith("text/") ||
    contentType.includes("xml") ||
    contentType.includes("yaml") ||
    contentType.includes("csv") ||
    contentType.includes("html")
  ) {
    return response.text();
  }

  if (contentType.includes("json")) {
    try { return response.json(); } catch { return response.text(); }
  }

  const buffer = await (await response.blob()).arrayBuffer();
  return Buffer.from(buffer);
}

/**
 * Parse raw bytes (from Electron IPC) into the appropriate JS value.
 */
export function parseRestResponseBytes(bytes: Buffer, contentType: string | null): Buffer | string | null {
  if (contentType?.startsWith("text/") || contentType?.includes("xml") || contentType?.includes("yaml")) {
    return bytes.toString();
  }
  if (contentType?.includes("json")) {
    try { return JSON.parse(bytes.toString()); } catch { return bytes.toString(); }
  }
  if (
    contentType?.startsWith("image/") ||
    contentType?.startsWith("video/") ||
    contentType?.startsWith("audio/") ||
    contentType?.includes("pdf") ||
    contentType?.includes("octet-stream")
  ) {
    return bytes;
  }
  return null;
}

/**
 * Build a BaseResponse from the raw parts returned by a successful request.
 */
export function buildRestResponse(
  status: number,
  statusText: string,
  headers: Headers | Record<string, string> | [string, string][],
  contentType: string | null,
  body: Buffer | string | object | null,
  url: string,
  elapsedTime: number,
  error: string | null,
  prerequestResult?: any,
  testRunnerResult?: any,
): BaseResponse {
  const headersArray = Array.isArray(headers)
    ? (headers as [string, string][]).map(([key, value]) => ({ key, value }))
    : headers instanceof Headers
    ? Array.from((headers as Headers).entries()).map(([key, value]) => ({ key, value }))
    : Object.entries(headers).map(([key, value]) => ({ key, value }));

  const bodyString = typeof body === "string" ? body : JSON.stringify(body);
  const bytesContent = new TextEncoder().encode(JSON.stringify({ body, headers })).length +
    (contentType &&
      (contentType.startsWith("image/") ||
        contentType.startsWith("video/") ||
        contentType.startsWith("audio/") ||
        contentType.includes("application/pdf") ||
        contentType.includes("application/octet-stream"))
      ? String(body).length
      : 0);

  return {
    statusCode: status,
    statusMessage: statusText,
    headers: headersArray,
    contentType,
    elapsedTime,
    body,
    url,
    bytesContent,
    error,
    prerequestResult,
    testRunnerResult,
  };
}

/**
 * Convert a RestRequest into the PreparedRequestState format used by the
 * Electron secure-send IPC channel.
 */
export async function prepareRestRequestState(data: RestRequest): Promise<PreparedRequestState> {
  const mergedHeaders = await buildAuthHeaders(data.headers, data.auth);
  const queryString = buildQueryString(data.params, data.auth);

  const headersArray = Object.entries(mergedHeaders).map(([key, value]) => ({ key, value, enabled: true }));

  const queryParamsArray = data.params.filter((p) => p.enabled).map((p) => ({ key: p.key, value: p.value, enabled: p.enabled }));

  if (data.auth?.enabled && data.auth.config) {
    if (data.auth.type === "api-key" && data.auth.config.in === "query" && data.auth.config.key) {
      queryParamsArray.push({ key: data.auth.config.key, value: data.auth.config.value || "", enabled: true });
    } else if (data.auth.type === "oauth2" && data.auth.config.addTokenTo === "query" && data.auth.config.accessToken) {
      queryParamsArray.push({ key: "access_token", value: data.auth.config.accessToken, enabled: true });
    }
  }

  const yamlTypes = ["application/x-yaml", "application/yaml", "text/yaml", "text/x-yaml"];
  const isYaml = yamlTypes.includes(data.content_type || "");
  const normalizedBody = isYaml && typeof data.body !== "string"
    ? (data.body == null ? "" : String(data.body))
    : data.body;

  return {
    method: data.method,
    url: data.url,
    headers: headersArray,
    queryParams: queryParamsArray,
    pathParams: (data.path_params || []).filter((p) => p.enabled).map((p) => ({ key: p.key, value: p.value, enabled: p.enabled })),
    body: normalizedBody,
    contentType: data.content_type,
    bodyParams: data.body_params?.map((p) => ({ key: p.key, value: p.value, type: p.type, enabled: p.enabled })),
    binary: data.binary,
    authProfile: undefined,
    preRequestResult: data.preRequestResult,
    metadata: {},
  };
}

/**
 * Send a REST request via Electron's legacy `send-request` IPC channel.
 * This is the legacy direct-send path — the active pipeline uses sendRequestHybrid
 * which routes through `send-secure-request` instead.
 */
export async function sendRestRequest(
  data: RestRequest,
  signal?: AbortSignal,
  electron?: any,
): Promise<BaseResponse | undefined> {
  const headers = await buildAuthHeaders(data.headers, data.auth);
  const parameters = buildQueryString(data.params, data.auth);
  const body = buildRestBody(data.content_type || "none", data.body || "", data.body_params || [], data.binary);

  let url = (data.url.substring(0, 4).includes("http") ? data.url : `http://${data.url}`).concat(
    data.url.includes("?") ? parameters.replace("?", "&") : parameters,
  );

  const fetchOptions: RequestInit = { method: data.method, headers };

  if (body && data.method !== "GET") {
    fetchOptions.body = body as BodyInit;
    const ctKey = Object.keys(headers).find((k) => k.toLowerCase() === "content-type");
    if (data.content_type !== "multipart/form-data") {
      if (ctKey) (headers as any)[ctKey] = data.content_type;
      else (headers as any)["Content-Type"] = data.content_type;
    }
    fetchOptions.headers = headers;
  }

  try {
    const startTime = performance.now();
    // Route through Electron IPC (legacy send-request channel)
    const response = await _sendViaElectron(url, fetchOptions, signal, electron);
    const elapsed = performance.now() - startTime;

    if (response instanceof Response) {
      const parsedBody = await parseRestResponse(response);
      return buildRestResponse(
        response.status, response.statusText,
        Object.fromEntries(response.headers.entries()),
        response.headers.get("content-type"),
        parsedBody, response.url, elapsed, null, data.preRequestResult,
      );
    }
  } catch (error: any) {
    return buildRestResponse(0, "", {}, null, null, "", 0, error.message);
  }
}

/**
 * Send a REST request via Electron's secure `send-secure-request` IPC channel.
 * Variables are replaced in the Electron main process.
 */
export async function sendRestRequestSecure(
  data: RestRequest,
  signal?: AbortSignal,
  electron?: any,
): Promise<BaseResponse | undefined> {
  if (!electron || !(window as any).electron?.request?.sendSecure) {
    throw new Error("Secure request API not available");
  }

  try {
    const startTime = performance.now();
    const requestState = await prepareRestRequestState(data);
    const response = await (window as any).electron.request.sendSecure(
      requestState,
      signal ? { aborted: signal.aborted } : undefined,
    );
    const elapsed = performance.now() - startTime;

    if (!response.status && response.statusText) {
      return buildRestResponse(0, response.statusText, {}, null, null, "", elapsed, response.error || response.statusText, data.preRequestResult);
    }

    const headersObj: Record<string, string> = {};
    if (response.headers) {
      response.headers.forEach(([k, v]: [string, string]) => { headersObj[k] = v; });
    }

    let body: any = null;
    if (response.body) {
      const buf = Buffer.from(response.body);
      const ct = headersObj["content-type"] || "";
      if (ct.includes("json")) { try { body = JSON.parse(buf.toString()); } catch { body = buf.toString(); } }
      else if (ct.includes("text/")) { body = buf.toString(); }
      else { body = buf; }
    }

    return buildRestResponse(
      response.status, response.statusText, headersObj,
      headersObj["content-type"] || null, body,
      response.requestMeta?.url || requestState.url, elapsed, null, data.preRequestResult,
    );
  } catch (error: any) {
    return buildRestResponse(0, "", {}, null, null, "", 0, error.message);
  }
}

// ── Internal transport ────────────────────────────────────────────────────────

async function _sendViaElectron(
  url: string,
  fetchOptions: RequestInit,
  signal?: AbortSignal,
  electron?: any,
): Promise<Response> {
  if (!electron?.sendRequest) throw new Error("Electron is not available");

  let body: any = fetchOptions.body;
  let bodyHint: string | null = null;

  if (body instanceof FormData) {
    bodyHint = "FormData";
    const entries = Array.from(body.entries());
    for (let i = 0; i < entries.length; i++) {
      if (entries[i][1] instanceof File) {
        const buf = await (entries[i][1] as File).arrayBuffer();
        entries[i][1] = { name: (entries[i][1] as File).name, type: (entries[i][1] as File).type, buffer: Array.from(new Uint8Array(buf)) } as any;
      }
    }
    body = entries;
  } else if (body instanceof File) {
    bodyHint = "File";
    const buf = await body.arrayBuffer();
    body = { ...(body as any), buffer: new Uint8Array(buf) };
  }

  const responseObj = await electron.sendRequest(url, { ...fetchOptions, body, bodyHint }, signal ? { aborted: signal.aborted } : undefined);

  if (responseObj.statusText === "app-error") {
    return new Response(null, { status: 0, statusText: responseObj.statusText });
  }

  const headersArray = responseObj.headers as [string, string][];
  const contentType = headersArray.find(([k]) => k.toLowerCase() === "content-type")?.[1] || "application/octet-stream";

  const blobContent = responseObj.body
    ? new Blob([new Uint8Array(responseObj.body).buffer], { type: contentType })
    : null;

  return new Response(blobContent, {
    status: responseObj.status,
    statusText: responseObj.statusText,
    headers: new Headers(responseObj.headers),
  });
}
