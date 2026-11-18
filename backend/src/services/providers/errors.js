function responseMessage(payload) {
  const message = payload?.error?.message || payload?.error || payload?.message;
  return typeof message === "string" ? message : message == null ? "" : JSON.stringify(message);
}

function redactApiKey(message, apiKey) {
  return apiKey ? message.split(apiKey).join("[REDACTED]") : message;
}

function logProviderResponse(provider, status, payload, apiKey) {
  const detail = redactApiKey(responseMessage(payload), apiKey);
  console.error(`[${provider}] HTTP ${status}: ${detail || "No response message."}`);
}

function createProviderError({ provider, status, payload, apiKey, publicStatus = 502, message }) {
  const detail = redactApiKey(responseMessage(payload), apiKey);
  logProviderResponse(provider, status, payload, apiKey);
  const error = new Error(typeof message === "function" ? message(detail) : message || detail || "The provider could not complete the request.");
  error.status = publicStatus;
  error.providerStatus = status;
  error.provider = provider;
  return error;
}

function createMissingKeyError(provider, keyName) {
  const error = new Error(`The server has no ${provider} API key. Add ${keyName} to .env and restart.`);
  error.status = 503;
  error.providerStatus = 503;
  error.provider = provider;
  return error;
}

async function readProviderJson(response) {
  try {
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError" || error?.cause?.code === "ETIMEDOUT") {
      throw error;
    }
    return {};
  }
}

async function requestProvider(provider, apiKey, url, init) {
  try {
    const timeoutSignal = AbortSignal.timeout(60_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return await fetch(url, { ...init, signal });
  } catch (error) {
    if (!init.signal?.aborted) {
      console.error(`[${provider}] Request failed before an HTTP response: ${redactApiKey(error.message, apiKey)}`);
    }
    throw error;
  }
}

function isTransientProviderError(error, signal) {
  if (signal?.aborted) return false;
  return error?.providerStatus >= 500
    || error?.status >= 500
    || error?.name === "TimeoutError"
    || error?.code === "ETIMEDOUT"
    || error?.cause?.code === "ETIMEDOUT"
    || error?.name === "AbortError";
}

function isRetryableStreamError(error, signal) {
  return isTransientProviderError(error, signal)
    || (!signal?.aborted && (error?.providerStatus === 429 || error?.status === 429));
}

module.exports = {
  createProviderError,
  createMissingKeyError,
  logProviderResponse,
  readProviderJson,
  requestProvider,
  isTransientProviderError,
  isRetryableStreamError
};
